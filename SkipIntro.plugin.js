/**
 * @name SkipIntro
 * @description Skips intros, recaps and outros/credits for series and anime. Timestamps come from IntroDB, TheIntroDB and AniSkip.
 * @updateUrl none
 * @version 1.0.0
 * @author Custom
 */

(async function () {
    "use strict";

    const TAG = "[SkipIntro]";
    const TICK_MS = 300;
    const FETCH_TIMEOUT_MS = 8000;
    const MIN_SEGMENT_SEC = 3;          // ignore segments shorter than this
    const MAX_LENGTH_MISMATCH_SEC = 60; // AniSkip: ignore timings made for a very different cut
    const TOAST_MS = 6000;

    const LABELS = { intro: "Intro", recap: "Recap", outro: "Credits" };

    function log() {
        try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Settings (Stremio Enhanced settings panel when available)
    // ------------------------------------------------------------------
    const settings = {
        mode: "auto",        // "auto" = skip by itself, "button" = show a Skip button, "off"
        skip_intro: true,
        skip_recap: true,
        skip_outro: true
    };

    function toBool(v) { return v === true || v === "true" || v === 1 || v === "1"; }

    function applySetting(key, value) {
        if (value === undefined || value === null) return;
        if (key === "mode") {
            if (value === "auto" || value === "button" || value === "off") settings.mode = value;
        } else if (key in settings) {
            settings[key] = toBool(value);
        }
    }

    async function initSettings() {
        const api = (typeof StremioEnhancedAPI !== "undefined") ? StremioEnhancedAPI : null;
        if (!api || typeof api.registerSettings !== "function") {
            log("Settings API not found, using defaults (auto-skip everything).");
            return;
        }
        try {
            await api.registerSettings([
                {
                    key: "mode",
                    type: "select",
                    label: "Skip mode",
                    description: "Automatic skips by itself and shows an Undo button. Button shows a Skip button and waits for you.",
                    defaultValue: "auto",
                    options: [
                        { label: "Automatic", value: "auto" },
                        { label: "Show a Skip button", value: "button" },
                        { label: "Off", value: "off" }
                    ]
                },
                { key: "skip_intro", type: "toggle", label: "Skip intros / openings", defaultValue: true },
                { key: "skip_recap", type: "toggle", label: "Skip recaps", defaultValue: true },
                { key: "skip_outro", type: "toggle", label: "Skip outros / endings / credits", defaultValue: true }
            ]);
            for (const key of Object.keys(settings)) {
                try { applySetting(key, await api.getSetting(key)); } catch (e) { /* keep default */ }
                if (typeof api.onSettingChange === "function") {
                    api.onSettingChange(key, function (value) { applySetting(key, value); });
                }
            }
        } catch (e) {
            log("Could not register settings, using defaults.", e);
        }
    }

    // ------------------------------------------------------------------
    // What is playing?  (#/player/<stream>/<url>/<url>/<type>/<id>/<videoId>)
    // ------------------------------------------------------------------
    function parsePlayerHash(hash) {
        if (!hash || hash.indexOf("#/player") !== 0) return null;
        const parts = hash.split("?")[0].split("/");
        if (parts.length < 8) return null;
        let videoId;
        try { videoId = decodeURIComponent(parts[7]); } catch (e) { return null; }
        return parseVideoId(videoId);
    }

    function parseVideoId(videoId) {
        if (!videoId) return null;
        let m = /^(tt\d+)(?::(\d+):(\d+))?$/.exec(videoId);
        if (m) {
            return {
                key: videoId,
                kind: "imdb",
                imdb: m[1],
                season: m[2] !== undefined ? Number(m[2]) : null,
                episode: m[3] !== undefined ? Number(m[3]) : null
            };
        }
        m = /^(kitsu|mal|anilist|anidb):(\d+)((?::\d+)*)$/.exec(videoId);
        if (m) {
            const rest = m[3] ? m[3].split(":").filter(Boolean).map(Number) : [];
            return {
                key: videoId,
                kind: "anime",
                site: m[1],
                id: m[2],
                episode: rest.length ? rest[rest.length - 1] : 1
            };
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Network helpers
    // ------------------------------------------------------------------
    async function fetchJson(url) {
        const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
        const timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
        try {
            const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function num(v) {
        const n = Number(v);
        return (v === null || v === undefined || !isFinite(n)) ? null : n;
    }

    // A "candidate" is { type: intro|recap|outro, start: sec, end: sec|null (null = end of video), length: sec|null }

    // ---- Series / movies with IMDb ids --------------------------------
    async function loadIntroDb(info) {
        let url = "https://api.introdb.app/segments?imdb_id=" + info.imdb;
        if (info.season !== null && info.episode !== null) url += "&season=" + info.season + "&episode=" + info.episode;
        const data = await fetchJson(url);
        if (!data) return [];
        const out = [];
        for (const type of ["intro", "recap", "outro"]) {
            const seg = data[type];
            if (!seg) continue;
            const start = num(seg.start_sec);
            let end = num(seg.end_sec);
            if (start === null) continue;
            // keep post-credits scenes watchable
            if (type === "outro" && data.post_credits) {
                const pc = num(data.post_credits.start_sec);
                if (pc !== null && pc > start && (end === null || pc < end)) end = pc;
            }
            out.push({ type: type, start: start, end: end, length: null });
        }
        return out;
    }

    async function loadTheIntroDb(info) {
        let url = "https://api.theintrodb.org/v4/media?imdb_id=" + info.imdb;
        if (info.season !== null && info.episode !== null) url += "&season=" + info.season + "&episode=" + info.episode;
        const data = await fetchJson(url);
        if (!data) return [];
        const out = [];
        const map = { intro: "intro", recap: "recap", credits: "outro" };
        for (const field of Object.keys(map)) {
            const list = data[field];
            if (!Array.isArray(list) || !list.length || !list[0]) continue;
            const startMs = num(list[0].start_ms);
            const endMs = num(list[0].end_ms);
            out.push({
                type: map[field],
                start: startMs === null ? 0 : startMs / 1000,
                end: endMs === null ? null : endMs / 1000,
                length: null
            });
        }
        return out;
    }

    async function loadImdb(info) {
        const results = await Promise.all([loadIntroDb(info), loadTheIntroDb(info)]);
        const merged = results[0].slice();
        for (const cand of results[1]) {
            if (!merged.some(function (c) { return c.type === cand.type; })) merged.push(cand);
        }
        return merged;
    }

    // ---- Anime (Kitsu / MAL / AniList / AniDB ids) --------------------
    const malCache = new Map();

    async function resolveMalId(info) {
        if (info.site === "mal") return info.id;
        const cacheKey = info.site + ":" + info.id;
        if (malCache.has(cacheKey)) return malCache.get(cacheKey);

        let mal = null;
        if (info.site === "kitsu") {
            for (const host of ["https://kitsu.app", "https://kitsu.io"]) {
                const data = await fetchJson(host + "/api/edge/anime/" + info.id + "/mappings");
                const rows = data && Array.isArray(data.data) ? data.data : [];
                for (const row of rows) {
                    const a = row && row.attributes;
                    if (a && a.externalSite === "myanimelist/anime" && a.externalId) { mal = String(a.externalId); break; }
                }
                if (mal) break;
            }
        }
        if (!mal) {
            const data = await fetchJson("https://api.ani.zip/mappings?" + info.site + "_id=" + info.id);
            const id = data && data.mappings && data.mappings.mal_id;
            if (id) mal = String(id);
        }
        if (mal) malCache.set(cacheKey, mal);
        return mal;
    }

    async function loadAnime(info) {
        const mal = await resolveMalId(info);
        if (!mal) { log("No MyAnimeList id found for", info.key); return []; }
        const url = "https://api.aniskip.com/v2/skip-times/" + mal + "/" + info.episode +
            "?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=0";
        const data = await fetchJson(url);
        const rows = data && data.found && Array.isArray(data.results) ? data.results : [];
        const typeMap = { "op": "intro", "mixed-op": "intro", "ed": "outro", "mixed-ed": "outro", "recap": "recap" };
        const out = [];
        for (const row of rows) {
            const interval = row.interval || {};
            const type = typeMap[row.skipType || row.skip_type];
            const start = num(interval.startTime !== undefined ? interval.startTime : interval.start_time);
            const end = num(interval.endTime !== undefined ? interval.endTime : interval.end_time);
            const length = num(row.episodeLength !== undefined ? row.episodeLength : row.episode_length);
            if (!type || start === null || end === null) continue;
            out.push({ type: type, start: start, end: end, length: length && length > 0 ? length : null });
        }
        return out;
    }

    // Turn raw candidates into final segments for a video of this duration.
    function resolveSegments(candidates, duration) {
        const best = {};
        for (const cand of candidates) {
            const mismatch = cand.length === null ? 0 : Math.abs(cand.length - duration);
            if (mismatch > MAX_LENGTH_MISMATCH_SEC) continue;
            const start = Math.max(0, cand.start);
            const end = Math.min(cand.end === null ? duration : cand.end, duration);
            if (start >= duration || end - start < MIN_SEGMENT_SEC) continue;
            if (!best[cand.type] || mismatch < best[cand.type].mismatch) {
                best[cand.type] = { type: cand.type, start: start, end: end, mismatch: mismatch };
            }
        }
        return Object.keys(best).map(function (k) { return best[k]; });
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------
    const ui = { root: null, button: null, toast: null, toastText: null, undo: null, toastTimer: null, onSkip: null, onUndo: null };

    function styleButton(el) {
        el.style.cssText = [
            "display:none", "align-items:center", "gap:0.5em", "cursor:pointer",
            "padding:0.75em 1.4em", "border-radius:2em", "border:2px solid rgba(255,255,255,0.85)",
            "background:rgba(15,15,25,0.82)", "color:#fff", "font:600 15px/1.2 system-ui,Segoe UI,Roboto,sans-serif",
            "box-shadow:0 4px 18px rgba(0,0,0,0.5)", "user-select:none", "pointer-events:auto"
        ].join(";");
    }

    function buildUi() {
        const root = document.createElement("div");
        root.id = "skipintro-ui";
        root.style.cssText = "position:fixed;right:2.5rem;bottom:7.5rem;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:0.6rem;pointer-events:none";

        const toast = document.createElement("div");
        styleButton(toast);
        toast.style.cursor = "default";
        toast.style.borderColor = "rgba(255,255,255,0.3)";
        const toastText = document.createElement("span");
        const undo = document.createElement("span");
        undo.textContent = "Undo";
        undo.style.cssText = "cursor:pointer;text-decoration:underline;margin-left:0.6em";
        undo.addEventListener("click", function (e) { e.stopPropagation(); if (ui.onUndo) ui.onUndo(); });
        toast.appendChild(toastText);
        toast.appendChild(undo);

        const button = document.createElement("div");
        styleButton(button);
        button.setAttribute("role", "button");
        button.addEventListener("click", function (e) { e.stopPropagation(); if (ui.onSkip) ui.onSkip(); });

        root.appendChild(toast);
        root.appendChild(button);
        ui.root = root; ui.button = button; ui.toast = toast; ui.toastText = toastText; ui.undo = undo;
    }

    function attachUi() {
        if (!ui.root) buildUi();
        const host = document.querySelector('[class*="player-container"]') || document.body;
        if (host && ui.root.parentNode !== host) host.appendChild(ui.root);
    }

    function showButton(seg, onSkip) {
        attachUi();
        ui.onSkip = onSkip;
        const text = "Skip " + LABELS[seg.type] + "  ⏭";
        if (ui.button.textContent !== text) ui.button.textContent = text;
        ui.button.style.display = "flex";
    }

    function hideButton() {
        if (ui.button) ui.button.style.display = "none";
        ui.onSkip = null;
    }

    function showToast(text, onUndo) {
        attachUi();
        ui.toastText.textContent = text;
        ui.onUndo = function () { hideToast(); onUndo(); };
        ui.toast.style.display = "flex";
        if (ui.toastTimer) clearTimeout(ui.toastTimer);
        ui.toastTimer = setTimeout(hideToast, TOAST_MS);
    }

    function hideToast() {
        if (ui.toastTimer) { clearTimeout(ui.toastTimer); ui.toastTimer = null; }
        if (ui.toast) ui.toast.style.display = "none";
        ui.onUndo = null;
    }

    // ------------------------------------------------------------------
    // Main loop
    // ------------------------------------------------------------------
    const state = {
        key: null,          // id of the episode being played
        token: 0,           // guards against late network answers
        candidates: null,   // null while loading
        segments: [],
        duration: 0,
        flags: {}           // per segment type: { skipped, dismissed }
    };

    function isEnabled(type) {
        if (type === "intro") return settings.skip_intro;
        if (type === "recap") return settings.skip_recap;
        if (type === "outro") return settings.skip_outro;
        return false;
    }

    function onNavigate(info) {
        state.key = info ? info.key : null;
        state.token++;
        state.candidates = null;
        state.segments = [];
        state.duration = 0;
        state.flags = {};
        hideButton();
        hideToast();
        if (!info) return;

        const token = state.token;
        const loader = info.kind === "imdb" ? loadImdb(info) : loadAnime(info);
        loader.then(function (candidates) {
            if (token !== state.token) return;
            state.candidates = candidates || [];
            log(info.key, "->", state.candidates.length ? state.candidates : "no timestamps found");
        }).catch(function (e) {
            if (token !== state.token) return;
            state.candidates = [];
            log("Lookup failed for", info.key, e);
        });
    }

    function skip(video, seg, automatic) {
        const from = video.currentTime;
        const atEnd = seg.end >= video.duration - 1;
        const target = atEnd ? Math.max(video.duration - 0.3, 0) : seg.end;
        const flags = state.flags[seg.type] || (state.flags[seg.type] = {});
        flags.skipped = true;
        hideButton();
        try { video.currentTime = target; } catch (e) { log("Seek failed", e); return; }
        log("Skipped " + seg.type + ": " + from.toFixed(1) + "s -> " + target.toFixed(1) + "s");
        if (automatic) {
            showToast("Skipped " + LABELS[seg.type].toLowerCase(), function () {
                flags.dismissed = true;
                try { video.currentTime = from; } catch (e) { /* ignore */ }
            });
        }
    }

    function tick() {
        const info = parsePlayerHash(location.hash);
        const key = info ? info.key : null;
        if (key !== state.key) onNavigate(info);

        if (!state.key || settings.mode === "off" || !state.candidates) { hideButton(); return; }

        const video = document.querySelector("video");
        if (!video || !isFinite(video.duration) || video.duration <= 0) { hideButton(); return; }

        if (Math.abs(video.duration - state.duration) > 1) {
            state.duration = video.duration;
            state.segments = resolveSegments(state.candidates, video.duration);
        }

        const t = video.currentTime;
        let active = null;
        for (const seg of state.segments) {
            if (isEnabled(seg.type) && t >= seg.start && t < seg.end - 1) { active = seg; break; }
        }
        if (!active) { hideButton(); return; }

        const flags = state.flags[active.type] || {};
        if (settings.mode === "auto" && !flags.skipped && !flags.dismissed) {
            skip(video, active, true);
            return;
        }
        showButton(active, function () { skip(video, active, false); });
    }

    await initSettings();
    setInterval(function () {
        try { tick(); } catch (e) { log("Error", e); }
    }, TICK_MS);
    log("Loaded. Mode:", settings.mode);
})();
