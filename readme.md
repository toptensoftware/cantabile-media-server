# Cantabile Media Server

Cantabile Media Server is an experimental solution for MIDI controlled video and static image playback.
It's designed as an accompanying program for [Cantabile Live Performer Music Software](https://www.cantabilesoftware.com)
but should work with any MIDI Compatible software capable of sending MIDI events.

## Pre-requisites

This project assumes the user is reasonably technically competant, in particular with working with the system
command line and editing text files.

## Installation

To install:

1. Install [NodeJS](https://nodejs.org/en) (recommended v20.0).
2. Install [Git](https://git-scm.com/downloads)
3. From a command prompt install the cantabile-media-server package:

```
npm install -g github:toptensoftware/cantabile-media-server
```

(on non-Windows platforms may require `sudo`).

To update existing install, re-run the above command.

To uninstall:

```
npm uninstall -g cantabile-media-server
```


## Configuration

To setup the media server:

1. Create a directory to contain the various configuration and media files:

    ```
    $ mkdir MyMediaServer
    ```

2. In the created folder, create a file named `config.json` similar to that shown below.

    Replace the `midiPort` setting with the name of the MIDI port the server should listen on. To
    display a list of available MIDI ports run the command `cantabile-media-server --list-midi-devices`

    Adjust other settings as appropriate.

    ```
    {
        "baseDir": ".",
        "midiPort": "loopMIDI Port 1",
        "port": 3000,
        "programList": "programList.txt"
    }
    ```

3. In the same folder create the `programList.txt` similar to that shown below.

    This file maps MIDI program change events to specific video or static image files.

    ```
    # specifies the default for any programs not explicitly stated
    default: static1.jpg

    # specifies the base program number (0 or 1)
    base: 1

    # program number to media file mapping
    1: static1.jpg
    2: video2.mp4
    3: video3.mp4
    4: video4.mp4
    5: static2.jpg
    6: static3.jpg

    # program numbers can be in msb.lsb.pr format
    10.20.30: video1.webm

    # or bank.pr format
    234.10: video2.mp4

    ```

4. Place you video and image files in the same directory, like so:

    ![Sample Directory Listing](exampleDirListing.png)

5. Start the server by running the `cantabile-media-server` command. All going well you should see
   something like this:

    ![Sample Run](exampleRun.png)

6. Start a web-browser and navigate to the server's URL.  If you're on the same machine as the server
   is running, you can use `localhost:3000`:

   ![Sample Browser](exampleBrowser.png)

7. Repeat step 6 for as many "video" displays as you need.

8. Send MIDI commands to the server to control media file selection and playback.


## MIDI Implementation

The server currently supports the following MIDI events:

* Program Bank Selection (CC 0 and CC 32)
* Program Change Events
* MMC Sys-ex Message for Play, Pause and Stop

The 16 MIDI channels are supported and each web browser can view a single "channel" (selectable by the drop down 
on the web page).

On receiving a program change event, the program number will be mapped to a media file as configured 
in `programList.txt`.  Any currently connected displays will be updated to the newly selected media file.

Send MMC Play, Pause and Stop events to control playback.  The device Id byte of the MMC message controls which
MIDI channel to play/stop.   0 = all channels. 1 = MIDI Channel 1, 2 = MIDI Channel 2 etc...


## Supported Media Files

All media files must be natively supported by the browser. [See here](https://www.geeksforgeeks.org/html5-video/) for a
list of video formats.

The follow should work: .png, .jpg, .jpeg, .gif, .webp, .mp4, .webm and .ogv

If your media is in a different format you'll need to manually convert.  For video files this can be easily 
done with [ffmpeg](https://ffmpeg.org/):

```
ffmpeg -i input.mpg output.mp4
```


## Running Across Multiple Machines

The server can be configured to run across multiple machines:

* The server itself can be moved from the MIDI sending machine using MIDI software like rtpMIDI.
* The server can be configured to only serve media and not be MIDI controllable by omitting the MIDI port
  setting in `config.json`.  This can be used to create a separate media only server from which to 
  source media files.
* The program list can reference non-locally served files by prefixing the media file with `http://`


## Command Line

The `cantabile-media-server` commands supports the following command line arguments:

```
Usage: cantabile-media-server [options]

Options:
   --list-midi-devices      Shows a list of available midi devices
   --watch                  Watch and automatically reload program list file when changed
   --verbose                Shows more logging
   --help                   Shows this help
   --version                Shows version info
```