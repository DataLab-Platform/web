# Showcase mode

The **Showcase mode** plays automated, live demos of DataLab Web: the application drives itself at a readable pace, with captions, title cards and a visible pointer. It is meant for unattended screens, such as a conference booth, and only needs a browser: the demos run on the real application, nothing is pre-recorded.

## Starting the showcase from the menu

1. Open **Help > Showcase mode…**.
2. Choose the demos: the built-in demos, and one demo per installed application plugin (camera characterization, pulse characterization…).
3. Choose the options: **Loop** (play the demos again and again), **Pace** (slow, normal or fast) and **Full screen**.
4. Click **Start**.

The showcase replaces the current workspace: save it first if needed. The demos follow the language of the application (**View > Language**).

## The demos

| Id   | Demo                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `w1` | **Interactive imaging, zero install**: a workspace opened from the **File** menu, cross profiles, a profile with its full width at half-maximum, a region of interest dragged on the image, an edge filter and the color theme. |
| `w2` | **Python in the browser**: a notebook typed and run cell by cell, pushing its results to the Signals panel, then a macro using the same `proxy` API as DataLab desktop macros.                                                  |
| `w3` | **Verifiable provenance**: a capsule exported by DataLab desktop is inspected, opened with its provenance, replayed locally and reviewed.                                                                                       |
| `w4` | **AI assistant (replayed session)**: a request in plain language, the macro proposed by the assistant, approved and run.                                                                                                        |

Each installed **application plugin** (camera characterization, pulse characterization…) gets its own demo, played between the built-in ones, with the id `app:<plugin id>` shown in the **Showcase mode** dialog. Plugins contain no showcase code: the demo is generated from what the plugin already declares for the **Applications** window — its name and description, its examples and the methods (recipes) they are designed for. It opens the **Applications** window, presents the plugin, plays up to two of its examples as a visitor would (**Try with this example**, parameters, run), shows the objects and result tables the method produced, and ends with an invitation to explore the other methods of the plugin. A plugin without any example only gets its page and description.

The capsule demo (`w3`) writes nothing to disk: the files it opens are bundled with DataLab Web, and the report and the review it saves are kept in the page instead of being downloaded. The capsule revision recorded when the capsule is inspected is forgotten at the end of the demo, so that it leaves no revision behind. Likewise, the notebook and the macro of the Python demo (`w2`) are closed at the end and removed from the **Recent…** lists, and your AI Assistant settings and conversations are left as they were (see below).

Between two demos, the workspace is emptied as a new, untitled and unmodified one, and the Python workers of the notebooks and macros are kept warm.

The AI assistant demo replays a scripted session, flagged on screen by a permanent "Replayed session" label: no request leaves the browser, no AI provider or API key is needed, and your AI Assistant settings, input history and conversations are left as they were. The macros it runs are real, as are their results.

While the demos play, clicks are ignored so that a visitor cannot disturb them, and these keys control the showcase:

| Key           | Effect                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| **F9**        | Pause or resume.                                                                                               |
| **Shift+F12** | Stop after the current demo and give the application back to the visitors; press it again to resume the demos. |
| **Esc**       | Quit the showcase.                                                                                             |

## Kiosk mode: starting from the address

The showcase also starts by itself, without any interaction, when the application is opened with the `showcase` parameter in its address. For a booth screen, open DataLab Web in a kiosk window of the browser, for example:

```powershell
chrome --kiosk "https://datalab-platform.com/web/?showcase=1&loop=1&lang=fr"
```

| Parameter    | Effect                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `showcase=1` | Play every demo. `showcase=w1,w2` plays a selection, identified by the demo ids shown in the **Showcase mode** dialog.   |
| `loop=1`     | Play the demos in a loop.                                                                                                |
| `speed=0.7`  | Pace multiplier: below 1 is faster, above 1 is slower (default: 1).                                                      |
| `reload=5`   | In a loop, reload the page every 5 loops (default) to start again with a fresh Python runtime; `reload=0` never reloads. |
| `close=1`    | Play the demos once (no loop), then close the window: see **Web interlude** below.                                       |
| `lang=fr`    | Language of the application and of the captions (`en` or `fr`).                                                          |

In kiosk mode, **Esc** quits only once **Shift+F12** has stopped the demos, so that a visitor cannot end the loop by accident.

On the first start, the browser downloads the Python runtime (one to three minutes, depending on the network): a title card is displayed meanwhile, until the Python workers needed by the demos (notebook kernel, macros) are ready. The next starts use the browser cache.

## Recommended booth setup

- Run the showcase in a dedicated browser window in kiosk mode, e.g. `chrome --kiosk "https://datalab-platform.com/web/?showcase=1&loop=1&lang=fr"` (full screen, no address bar nor tabs). Prefer Chrome or Edge; a Full HD screen (1920 × 1080) is ideal.
- Keep that tab visible and in the foreground: browsers slow down the timers and the animations of hidden or minimized tabs, so the demos would stall or stutter. Disable the screen saver and the sleep of the computer instead of covering the window.
- Warm the browser cache before the event: open the showcase page once, on the same computer and with the same browser profile, and let it play a full loop. The Python runtime and the packages are then loaded from the cache, so that the showcase starts within seconds even on a slow or busy conference network.
- Keep the default `reload=5`: reloading the page every few loops starts again with a fresh Python runtime, so that an unattended screen can run for a whole day.
- To take over for a visitor, press **Shift+F12** (the demos stop after the current one); press it again to resume.

## Web interlude: closing the window after the demos

With `close=1`, the showcase plays the requested demos once, without looping, shows its closing card, then closes its window by itself. This lets another program play DataLab Web demos as an "interlude" on a single screen and resume once they are over: DataLab desktop, for instance, opens DataLab Web in a dedicated browser application window for one pass, and waits for the browser to exit, e.g.:

```powershell
chrome --app="https://datalab-platform.com/web/?showcase=w1,w2&close=1&lang=fr"
```

A browser lets a page close only the windows that a script opened, or that have a single page in their history, such as an application window opened with `--app=<url>`. When the browser refuses to close the window (e.g. a regular tab, or after navigating within the window), the closing card stays on screen with a discreet "You can close this window." message, and the window can be closed by hand. `close=1` implies a single pass: `loop` and `reload` are then ignored.

To wait for the end of the interlude, give the window its own browser profile (`--user-data-dir=<folder>`): the browser then runs in its own processes, which exit when the window closes. Some browsers (Microsoft Edge, for instance) hand the first process over to another one, which exits at once: wait until no process uses that profile anymore rather than for the process started first.
