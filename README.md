# SkipIntro for Stremio Enhanced

A plugin for [Stremio Enhanced](https://github.com/REVENGE977/stremio-enhanced) that skips intros, recaps and outros/credits in series and anime.

> **Note:** this is a plugin for Stremio Enhanced, a community desktop client. It is **not** a normal Stremio addon and does not work in the official Stremio app, because Stremio addons cannot control the player.

## Features

- Skips **intros / openings**, **recaps** and **outros / endings / credits**
- Works for **series** (IMDb ids) and **anime** (Kitsu, MyAnimeList, AniList and AniDB ids)
- Two modes:
  - **Automatic**: skips by itself and shows an **Undo** button for a few seconds
  - **Skip button**: shows a "Skip Intro" button and waits for you
- Each segment type can be turned on or off in the settings
- Keeps post-credits scenes watchable when the database knows about them
- No account and no API key needed

## Install

1. Install Stremio Enhanced from its [releases page](https://github.com/REVENGE977/stremio-enhanced/releases).
   On Windows you can use winget:
   ```
   winget install REVENGE.StremioEnhanced
   winget install Stremio.StremioService
   ```
2. Download [`SkipIntro.plugin.js`](SkipIntro.plugin.js) from this repository.
3. Open Stremio Enhanced, go to **Settings**, scroll down and click **OPEN PLUGINS FOLDER**.
4. Put `SkipIntro.plugin.js` in that folder.
5. Restart Stremio Enhanced (or press `Ctrl` + `R`).
6. Enable **SkipIntro** in Settings.

## Settings

| Setting | Options | Default |
| --- | --- | --- |
| Skip mode | Automatic / Show a Skip button / Off | Automatic |
| Skip intros / openings | On / Off | On |
| Skip recaps | On / Off | On |
| Skip outros / endings / credits | On / Off | On |

## How it works

The plugin reads the id of the episode you are playing and asks community timestamp databases where the intro, recap and credits are. While the video plays, it checks the current time and skips when you enter one of those segments.

| Content | Source |
| --- | --- |
| Series and movies (IMDb id) | [IntroDB](https://introdb.app), then [TheIntroDB](https://theintrodb.org) for anything IntroDB is missing |
| Anime (Kitsu / MAL / AniList / AniDB id) | [AniSkip](https://github.com/aniskip) |

For anime, the id is first converted to a MyAnimeList id using the Kitsu API, with [ani.zip](https://api.ani.zip) as a fallback.

## Limitations

- **Coverage depends on the community.** If nobody has submitted timestamps for an episode, nothing is skipped. You can add timestamps on the IntroDB and AniSkip sites.
- **Anime works best from the Anime Kitsu addon.** AniSkip needs a MyAnimeList id, which the plugin can only get when the anime was opened from a Kitsu, MAL, AniList or AniDB catalog. Anime opened from the default Cinemeta catalog uses the series databases, which have less anime.
- **Timestamps can be off** if your video file is a different cut from the one the timestamps were made for. For AniSkip, timestamps made for an episode length that differs by more than 60 seconds are ignored.
- This is an early version. Please report problems in the Issues tab.

## Troubleshooting

Press `Ctrl` + `Shift` + `I` in Stremio Enhanced, open the **Console** tab and look for lines that start with `[SkipIntro]`. They show which episode was detected, which timestamps were found and when a skip happened. Include those lines when you open an issue.

## Privacy

The plugin sends only the id of the show (IMDb, Kitsu, MAL, AniList or AniDB id) and the season and episode number to the timestamp services listed above. It does not send any account data and stores nothing outside the Stremio Enhanced settings.

## Credits

- [Stremio Enhanced](https://github.com/REVENGE977/stremio-enhanced) by REVENGE977
- Intro data provided by [IntroDB](https://introdb.app)
- [TheIntroDB](https://theintrodb.org)
- [AniSkip](https://github.com/aniskip)

## Disclaimer

This project is not affiliated with Stremio, Stremio Enhanced, IntroDB, TheIntroDB or AniSkip.
