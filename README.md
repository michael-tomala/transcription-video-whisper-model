# Transcription Video with Whisper

Generates SRT subtitles for video files (or YouTube URLs) using Whisper.
Two interchangeable backends:

| | `--backend openai` (default) | `--backend local` |
|---|---|---|
| Engine | OpenAI API, `whisper-1` | whisper.cpp on your machine |
| Cost | per minute of audio | free |
| Privacy | audio leaves your machine | audio never leaves your machine |
| Speed | upload bound | ~10× realtime on an Apple M2 Pro |
| Silence | not removed | removed via Silero VAD before transcription |
| File size | split into <20 MB chunks (API limit) | no limit, one pass |

Both backends produce the exact same output files.

## Prerequisites

- Node.js 20+ and `ffmpeg` on your PATH.
- For `--backend openai`: an OpenAI API key.
- For `--backend local`: `brew install whisper-cpp`, a ggml model and the VAD model (below).

## Installation

```bash
npm install
```

For the OpenAI backend, create a `.env` file:

```
OPENAI_API_KEY=your-api-key
```

### Setting up the local backend

1. Install whisper.cpp:

```bash
brew install whisper-cpp
```

2. Download the Silero VAD model (~860 KB) used to cut silence:

```bash
mkdir -p models
curl -fL -o models/ggml-silero-v5.1.2.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
```

3. Point the tool at a ggml Whisper model. By default it uses the `large` alias, which
   resolves to `~/Library/Application Support/superwhisper/ggml-large.bin` (large-v2,
   multilingual — required for anything other than English). Override with `--model`
   or in `.env`:

```
WHISPER_MODEL_PATH=/path/to/ggml-large-v3-turbo.bin
WHISPER_VAD_MODEL_PATH=/path/to/ggml-silero-v5.1.2.bin
```

## Usage

```bash
node index.js ./path-to-video.mp4                      # OpenAI API
node index.js ./path-to-video.mp4 --backend local      # whisper.cpp, Polish by default
node index.js 'https://youtu.be/VIDEO_ID' --backend local
```

### Options

```
--backend <openai|local>   transcription engine (default: openai)
--model <path|alias>       ggml model for the local backend (large, small, or a path)
--vad / --no-vad           cut silence before transcription (default: on for local)
--vad-model <path>         Silero VAD model
--language <code>          spoken language (default: pl)
--prompt <text>            proper nouns / jargon to hint to the model (both backends)
--threads <n>              whisper.cpp threads (default: 8)
--min-words-duration <ms>  minimum on-screen duration per phrase in SRT (default: 500)
--output-dir <path>        output directory (default: output/<name>)
--job                      run detached in the background, print a jobId and exit
--help                     show help
```

The second positional argument is still accepted as `--min-words-duration`, so
`node index.js ./video.mp4 800` keeps working.

### Hinting proper nouns

Whisper mangles names, domains and jargon it has no context for — `claude4spec.inharness.ai`
comes back as `www.cloth4spec.in.harness.ai`. Pass the terms as an initial prompt and the
decoder gets them in context before it hears a word:

```bash
node index.js ./video.mov --backend local \
  --prompt "claude4spec.inharness.ai, Claude Code, NPM, MCP"
```

Both backends accept it: the local one forwards it to `whisper-cli --prompt`, the OpenAI one
sends it as the API's `prompt` parameter (repeated for every <20 MB chunk, as OpenAI
recommends). Whisper truncates the prompt to 224 tokens silently, so keep it to the terms that
actually matter — the CLI warns when the text is long enough to risk being cut. A term set in a
natural sentence ("Wchodzimy na stronę claude4spec.inharness.ai.") sometimes lands better than
a bare comma-separated list.

## Output

Files are written to `./output/<video-name>` (or `--output-dir`):

* `audio.mp3` / `audio.wav` — audio extracted from the video.
* `audio-vad.wav` — local backend only, audio with long silences removed.
* `whisper.json` — local backend only, raw whisper.cpp output.
* `transcription.json` — transcription with word- and segment-level timestamps.
* `transcription-reformatted.json` — timings adjusted to the minimum display duration.
* `transcription-words.srt` — subtitles word by word.
* `transcription-segments.srt` — subtitles in longer segments.

The default `output/<video-name>` directory is wiped before each run. A directory
you pass explicitly via `--output-dir` is **not** wiped — files are only added to
it — so that pointing the CLI at a directory that holds other files is safe.

## Background jobs

`--job` makes the CLI detach from its parent, so a plugin can spawn it, get an id
back immediately and poll for the result later.

```bash
$ node index.js ./screencast.mov --backend local --job
{"jobId":"j7f2abcd","eta":"~3 min","statePath":"…","logPath":"…","pid":8123}
```

The CLI validates its configuration (binaries, models, API key) **before** detaching,
so a misconfigured run fails immediately with a non-zero exit code instead of
silently erroring out in the background.

State is written to `~/.cache/ctowiec-screencast/jobs/<jobId>.json` and rewritten
every time progress or phase changes. Writes go through a temporary file plus
`rename`, so a reader never sees a truncated file.

```json
{
  "jobId": "j7f2abcd",
  "status": "pending | running | done | error",
  "phase": "extract | transcribe | postprocess",
  "progress": 0.41,
  "pid": 8123,
  "input": "screencast.mov",
  "artifactPath": "/…/output/screencast",
  "backend": "local",
  "model": "ggml-large.bin",
  "startedAt": "…", "updatedAt": "…", "finishedAt": null,
  "eta": "~3 min",
  "error": null
}
```

Poll until `status` is `done` (read `artifactPath`) or `error` (read `error`).
`SIGTERM`, `SIGINT` and uncaught exceptions all land in the state file as
`status: "error"`, so a job never hangs on `running` after its process dies.

Logs go to `~/.cache/ctowiec-screencast/jobs/<jobId>.log` as JSON Lines, one object
per line, including the raw output of `whisper-cli` and `ffmpeg`:

```bash
jq -c 'select(.level != "debug")' ~/.cache/ctowiec-screencast/jobs/j7f2abcd.log
```

To cancel a job, `kill -TERM <pid>` — the CLI terminates its `whisper-cli`/`ffmpeg`
children and records the cancellation in the state file.

## How silence removal works

The local backend does **not** use whisper.cpp's built-in `--vad`. That flag reports
timestamps on the compressed audio timeline rather than the original recording, which
would shift every subtitle after the first long pause.

Instead the pipeline runs `vad-speech-segments` separately, merges speech regions that
are less than 1.5 s apart (natural pauses help recognition, so only long silences are
worth cutting), pads each region by 250 ms, concatenates them with ffmpeg, and maps
every resulting timestamp back onto the original timeline with an exact piecewise
mapping. Timestamps are clamped so no word or segment can span a removed gap.

Disable it with `--no-vad` if you need whisper to see the untouched audio.

## License

This project is open-source and available under the MIT license.
