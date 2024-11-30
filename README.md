# Transcription Video with Whisper Model by OpenAI API

This project uses OpenAI's Whisper model to generate transcription for videos and outputs the result in SRT format.

## Prerequisites

- Node.js installed on your system.
- An OpenAI API key.

## Installation

1. Clone this repository:

```bash
git clone https://github.com/your-repo/transcription-whisper.git
cd transcription-whisper
```

2. Install dependencies:

```bash
npm install
```

3. Create a .env file in the root directory and add your OpenAI API key:

```
OPENAI_API_KEY=your-api-key
```

## Usage

### Basic Command

To transcribe a video file, run the following command:

```bash
node index.js ./path-to-video.mp4
```

This will process the video file located at ./path-to-video.mp4 and generate output files in the ./output directory.

### Adjusting Minimal Display Duration

You can specify a minimum display duration (in milliseconds) for each phrase in the SRT file. This ensures that shorter
phrases are displayed for a sufficient amount of time. For example:

```bash
node index.js ./path-to-video.mp4 800
```

This sets the minimum display duration for phrases to 800 milliseconds.

## Output

After running the transcription process, the following files will be created in the ./output/<video-name> directory:

* audio.mp3: The extracted audio file from the video, created using the fluent-ffmpeg library.
* transcription.json: The raw transcription file as received from the Whisper model.
* transcription-reformatted.json: The transcription file with adjusted timing for phrases to meet the minimum display duration.
* transcription-words.srt: An SRT file with subtitles displayed "word by word," using precise timestamps for each word.
* transcription-segments.srt: An SRT file with subtitles divided into longer segments as determined by the Whisper model.

### Example output Directory Structure

```
./output/example-video/
├── audio.mp3
├── transcription.json
├── transcription-reformatted.json
├── transcription-words.srt
├── transcription-segments.srt
```

## Limitations

The input video size should not exceed 25 MB due to OpenAI API limitations. If larger files are used, the script
automatically splits them into chunks.
Ensure that the Whisper API is enabled for your OpenAI account.

## License

This project is open-source and available under the MIT license.