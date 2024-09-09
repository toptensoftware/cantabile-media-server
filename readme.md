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
        "programList": "programList.txt",
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

    # WebRTC/WHEP realtime (camera) feeds are supported using webrtc+(url) format.  
    # Note: the URL must be the WHEP endpoint
    7: webrtc+http://localhost:8889/camera1/whep

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


## Supported Media Files

All media files must be natively supported by the browser. [See here](https://www.geeksforgeeks.org/html5-video/) for a
list of video formats.

The follow should work: .png, .jpg, .jpeg, .gif, .webp, .mp4, .webm and .ogv

If your media is in a different format you'll need to manually convert.  For video files this can be easily 
done with [ffmpeg](https://ffmpeg.org/):

```
ffmpeg -i input.mpg output.mp4
```


## Time Synchronisation

`cantabile-media-server` supports three time synchronization modes:

* `none` - each browser's video players maintains its own time which may drift or become very unsynchronized if started at different times
* `master` - the media server itself becomes the master time sync. source.
* `mtc` - the media server uses an external (ie: incoming) MIDI Time Code as the master time sync. source.

In `none` and `master` modes, playback is controlled by sending MMC Sys-ex Message for Play, Pause and Stop

In `mtc` modes, playback is started and stopped in response to MTC events received.

In `master` and `mtc` modes, periodic timestamp pings are sent to each connected client and the playback rate of the 
video players is constantly adjusted to keep the video as in-sync as possible.   If the discrepency between expected
time and actual time exceeds one second, the video instantly jumps to the expected timestamp and sync. resumes from 
that point onwards.

The default synchronization mode can be set for all video players in the main config file section, eg:

    ```
    {
        "baseDir": ".",
        "midiPort": "loopMIDI Port 1",
        "port": 3000,
        "programList": "programList.txt",
        "syncMode": "master",
    }
    ```

Each layer also has a customizable sync. mode - see Layers.


## Latency Compenstation

Each web browser client has a Latency Compenstation setting in the non-full screen Web UI.  When set to a non-zero 
value the time synchronization code will try to synchronize to a point that far into the future.  

This setting only takes effect when the video is actually playing and ignored when the video is stopped or paused.


## Layers

By default each channel supports a single "layer" of content.  For more complex setups you might like to create a
multi-layer configuration where multiple video/image layers are placed over each other and can be shown/hidden for
fast switching between different videos, images and camera feeds.

To set the layers for a channel, create a config file with "channels" and  "layers" sections like so:

```
{
    "baseDir": ".",
    "midiPort": "loopMIDI Port 1",
    "port": 3000,
    "programList": "programList.txt",
    "syncMode": "mtc",
    "channels": {
        "1": {
            "layers": [
                { 
                    "mediaFile": "band_logo.jpg" 
                },
                { 
                    "useProgramList": true,
                    "hiddenWhenStopped": true,
                },
                { 
                    "mediaFile": "webrtc+http://localhost:8889/mystream/whep",
                    "display": "hidden"
                }
            ]
        }
    }
}
```

The above example includes three layers:

* A background layer with a static image of the band logo
* A middle layer that shows the media file selected from the program list
* A top layer that's hidden by default but shows the real-time feed from a camera when shown

In this setup:

* By default, the band logo will be displayed
* If a program change causes a media file to be loaded for this channel, it will appear in place of the band logo
* MIDI commands can be used to arbitrarily unhide the camera feed.

Each layer supports the following settings:

* `mediaFile` - a media file to always show in this layer
* `display` - either 'visible' (the default if not specified), 'hidden' or 'inactive'
* `syncMode` - either 'none', 'master' or 'mtc' to set the sync mode for video's displayed in this layer.
* `useProgramList` - whether to load media from the program list (using the channel's selected program number)
* `programSlot` - which program number slot to use (see Program Slots below)
* `programNumberOffset` - an offset to add to the channel's selected program number when loading media
* `hiddenWhenStopped` - if true, automatically hides the layer when the video is stopped (shown when playing or paused)


## Program Slots

Normally MIDI only supports a single program number selection per MIDI channel.  Since `cantabile-media-server` supports
multiple display layers, sometimes you might want to select different media files on different layers.

To support this, each MIDI channel has 4 "program number slots".

* Program number slot 0 is the primary program number and is loaded by sending MIDI Program change events.
* MIDI CC's 70 - 73 are used to select program numbers for slots 0 to 3

(ie: program change and CC 70 are equivalent).

Note: all 4 program slots will use the standard MIDI program bank (MIDI CC's 0 and 32) at the time the program is loaded.

To have a layer use an alternative program number slot set the layer's `programSlot` setting (see above).



## Controlling Layer Visibility

Each layer has a visibility setting:

* `visible` - layer is active and shown (unless obscured by a higher level layer)
* `hidden` - layer is active (ie: loaded and maybe playing), but hidden allowing the next lower visible layer to be seen.
* `inactive` - layer is deactivated and hidden.

The visibility of a layer can be set in the config file, but can be changed on the fly using MIDI CCs 80 (layer 0) thru 
89 (layer 9) and sending the following values:

* 0 = inactive
* 1 = hidden
* any other value = visible



## MIDI Implementation

The server currently supports the following MIDI events:

* Program Bank Selection (CC 0 and CC 32)
* Program Change Events
* MMC Sys-ex Message for Play, Pause and Stop
* MIDI Time Code (MTC) to control playback and sync. video's configured with sync. mode 'mtc'
* CC 70 - 73 - program bank selection for alternate program slots 0 - 3
* CC 80 - 89 - controls visibility of layers 0 - 9.

The 16 MIDI channels are supported and each web browser can view a single "channel" (selectable by the drop down 
on the web page).

On receiving a program change event, the program number will be mapped to a media file as configured 
in `programList.txt`.  Any currently connected displays will be updated to the newly selected media file.

Send MMC Play, Pause and Stop events to control playback.  The device Id byte of the MMC message controls which
MIDI channel to play/stop.   0 = all channels. 1 = MIDI Channel 1, 2 = MIDI Channel 2 etc...



## Running Across Multiple Machines

The server can be configured to run across multiple machines:

* The server itself can be moved from the MIDI sending machine using MIDI software like rtpMIDI.
* The server can be configured to only serve media and not be MIDI controllable by omitting the MIDI port
  setting in `config.json`.  This can be used to create a separate media only server from which to 
  source media files.
* The program list can reference non-locally served files by prefixing the media file with `http://`



## Camera/Real-time Feeds

WebRTC feeds with a correct WHEP implementation are supported for real-time camera feeds.

To indicate to cantabile-media-server that a URL represents a webrtc feed prefix the
full WHEP endpoint url with webrtc+(url).

eg: suppose your realtime feed's WHEP end point is 

```http://localhost:8889/camera1/whep```

then full URL to be used in programList.txt would be 

```webrtc+http://localhost:8889/camera1/whep```

This is known to work with [mediamtx](https://github.com/bluenviron/mediamtx).

It currently does _not_ work with [go2rtc](https://github.com/AlexxIT/go2rtc) due to an
incomplete WHEP implementation.  Hopefully this will be rectified soon - [see here](https://github.com/AlexxIT/go2rtc/issues/1315).



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