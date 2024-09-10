#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import midi from '@julusian/midi';
import JSON5 from 'json5';
import { WebSocketServer } from 'ws';
import { parseCommandLine, showVersion } from './commandLine.js';
import { ProgramList } from './programList.js';
import { MidiMessage, MidiController, MidiMmc } from './midiTypes.js';
import { mimeTypeFromFile } from './mimeTypes.js';
import { formatSmpte, qframesToSmpte, smpteToQFrames, qframesToSeconds } from './smpte.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let cl;
try
{
    cl = parseCommandLine(process.argv);
}
catch (err)
{
    console.error(err.message);
    process.exit(7);
}

showVersion();

// List available midi devices?
if (cl.listMidiDevices)
{
    // List available midi ports
    let midiInput = new midi.Input();
    let midiPortCount = midiInput.getPortCount();
    for (let i=0; i<midiPortCount; i++)
    {
        console.log(`${i}: ${midiInput.getPortName(i)}`);
    }
    process.exit(0);
}



// App State
let app = express(); 
let sockets = [];
let programList = null;

let mtcFormat = 3;
let mtcQFrameNumber = 0;
let mtcTime = 0;
let mtcIsPlaying = false;
let mtcPieceMask = 0;
let mtcPieces = [ 0, 0, 0, 0, 0, 0, 0, 0 ]

// Load config
let config = JSON5.parse(fs.readFileSync("config.json", "utf8"));
if (cl.verbose)
    console.log(config);

// Load program list
if (config.programList !== undefined)
{
    programList = new ProgramList(config.programList);

    if (cl.watch)
    {
        // Watch for changes
        fs.watchFile(config.programList, function() {

            try
            {
                var newProgramList = new ProgramList(config.programList);
                programList = newProgramList;
                for (let i=0; i<16; i++)
                {
                    for (let j=0; j<4; j++)
                        OnProgramChange(i, j, channelStates[i].programNumberSlots[j], true);
                }
                if (cl.verbose)
                    console.log("Program list re-loaded");
            }
            catch (err)
            {
                console.error(`failed to reload program list - ${err.message}`);
            }
        });
    }
}

class LayerState
{
    constructor(channelIndex, layerIndex)
    {
        this.channelIndex = channelIndex;
        this.layerIndex = layerIndex;
        this.syncMode = config.syncMode ?? "master";
    }

    channelIndex = 0;
    layerIndex = 0;
    display = "visible";         // visible, hidden or inactive
    #baseTime = 0;
    #startPlayTime = null;
    #mediaFile = null;
    #mimeType = null;
    hasTransport = false;
    programNumberOffset = 0;


    get mediaFile() 
    {
        return this.#mediaFile; 
    }

    set mediaFile(value)
    {
        this.#mediaFile = value;
        this.#mimeType = mimeTypeFromFile(value);
        this.hasTransport = 
            this.#mimeType != null &&
            this.#mimeType.startsWith("video/") && 
            !this.#mediaFile.startsWith("webrtc+");
        this.#baseTime = 0;
        this.#startPlayTime = null;
    }

    get currentTime()
    {
        if (!this.hasTransport)
            return null;

        switch (this.syncMode)
        {
            case 'master':
                if (this.#startPlayTime != null)
                    return this.#baseTime + (Date.now() - this.#startPlayTime) / 1000;
                else
                    return this.#baseTime;

            case 'mtc':
                return mtcTime;
        }

        return null;
    }

    get isPlaying()
    {
        if (!this.hasTransport)
            return false;

        switch (this.syncMode)
        {
            case 'master':
                return this.#startPlayTime != null;

            case 'mtc':
                return mtcIsPlaying;
        }

        return false;
    }

    play()
    {
        if (!this.hasTransport)
            return;

        if (this.syncMode == 'master')
        {
            if (this.#startPlayTime != null)
                return;
            this.#startPlayTime = Date.now();
            this.onPlay()
        }   
    }
    
    onPlay()
    {
        broadcast({ 
            action: 'play', 
            channelIndex: this.channelIndex, 
            layerIndex: this.layerIndex,
            currentTime: this.currentTime 
        });
    }

    pause()
    {
        if (!this.hasTransport)
            return;

        if (this.syncMode == 'master')
        {
            if (this.#startPlayTime == null)
                return;
            this.#baseTime = this.currentTime;
            this.#startPlayTime = null;
            this.onPause();
        }

    }

    onPause()
    {
        broadcast({ 
            action: 'pause', 
            channelIndex: this.channelIndex,
            layerIndex: this.layerIndex, 
            currentTime: this.currentTime 
        });
    }

    stop()
    {
        if (!this.hasTransport)
            return;

        if (this.syncMode == 'master')
        {
            this.#startPlayTime = null;
            this.#baseTime = 0;
            this.onStop();
        }
    }
    
    onStop()
    {
        broadcast({ action: 'stop', channelIndex: this.channelIndex, layerIndex: this.layerIndex});
    }

    render()
    {
        return {
            channelIndex: this.channelIndex,
            layerIndex: this.layerIndex,
            display: this.display,
            mediaFile: this.#mediaFile,
            mimeType: this.#mimeType,
            currentTime: this.currentTime,
            isPlaying: this.isPlaying,
            hiddenWhenStopped : this.hiddenWhenStepped,
        }
    }
}

class ChannelState
{
    constructor(channelIndex)
    {
        this.channelIndex = channelIndex;
    }

    bank = 0;
    programNumberSlots = [ 0, 0, 0, 0 ];
    channelIndex;
    layers = [];

    render()
    {
        return {
            channelIndex: this.channelIndex,
            layers: this.layers.map(x => x.render()),
        }
    }
}

// Create channel states
let channelStates = [];
for (let ch=0; ch<16; ch++)
{
    // Create channel state
    var cs = new ChannelState(ch);

    // Merge state from config
    if (config.channels && typeof(config.channels[ch+1]) === 'object')
    {
        let layers = config.channels[ch + 1].layers;
        if (Array.isArray(layers))
        {
            for (let li=0; li<layers.length; li++)
            {
                // Create layer state, load config and add to channel state
                let layerState = new LayerState(ch, li);

                // Copy layer state from config
                layerState.mediaFile = qualifyMediaFile(layers[li].mediaFile);
                layerState.syncMode = layers[li.syncMode] ?? layerState.syncMode;
                layerState.useProgramList = layers[li].useProgramList === true;
                layerState.programSlot = layers[li].programSlot ?? 0;
                layerState.hiddenWhenStepped = layers[li].hiddenWhenStopped ?? false;
                layerState.programNumberOffset = layers[li].programNumberOffset ?? 0;
                layerState.display = layers[li].display ?? "visible";

                cs.layers.push(layerState);
            }
        }
    }

    // If layers not specified in config file, create a default config that shows media
    // file for specified program.
    if (cs.layers.length == 0)
    {
        // Create a default layer
        let layerState = new LayerState(ch, 0);
        layerState.useProgramList = true;
        layerState.programSlot = 0;
        cs.layers.push(layerState);
    }

    // Add to list
    channelStates.push(cs);
}

// Callback on all MTC active layers
function forAllMtcLayers(cb)
{
    for (let i=0; i<channelStates.length; i++)
    {
        let layers = channelStates[i].layers;
        for (let j=0; j<layers.length; j++)
        {
            if (layers[j].syncMode == 'mtc' && layers[j].hasTransport)
                cb(layers[j]);
        }
    }
}

// Setup express
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Package-schmackage
app.use("/whip-whep", express.static(path.join(__dirname, "./node_modules/whip-whep")));

// Setup session parser
let sessionParser = session({
    saveUninitialized: false,
    secret: "$eCuRiTy",
    resave: false,
});
app.use(sessionParser);
 
// Streaming media handler
app.get('/media/:file(*)', (req, res, next) => { 

    // If not a video streaming request, pass to static handler below
    if (!req.headers.range)
        return next();

    // Stream section of file
    const range = req.headers.range ;
    const videoPath = path.join(config.baseDir, req.params.file); 
    const videoSize = fs.statSync(videoPath).size;
    const chunkSize = 1 * 1e6; 
    const start = Number(range.replace(/\D/g, ""));
    const end = Math.min(start + chunkSize, videoSize - 1);
    const contentLength = end - start + 1; 
    const headers = { 
        "Content-Range": `bytes ${start}-${end}/${videoSize}`, 
        "Accept-Ranges": "bytes", 
        "Content-Length": contentLength, 
        "Content-Type": "video/mp4"
    } 
    res.writeHead(206, headers) 
    const stream = fs.createReadStream(videoPath, { 
        start, 
        end 
    }) 
    stream.pipe(res) 
});

// Static handler for non-streamed media files
app.use("/media", express.static(config.baseDir));

// List available midi ports
let midiInput = new midi.Input();

// Don't ignore sys-ex
midiInput.ignoreTypes(false, false, true);

// MIDI message handler
midiInput.on('message', (deltaTime, m) => {

    try
    {
        if ((m[0] & 0xF0) == 0xF0)
        {
            switch (m[0])
            {
                case MidiMessage.MtcQuarterFrame:
                {
                    let mtcWasPlaying = mtcIsPlaying;

                    // If we're receiving MTC quarter frames then we're playing
                    mtcIsPlaying = true;

                    // Update the current q-frame number
                    mtcQFrameNumber++;

                    // Update the current piece
                    let piece = (m[1] & 0x70) >> 4;
                    mtcPieces[piece] = m[1] & 0x0F;

                    // Track which pieces have been received
                    mtcPieceMask |= 1 << piece;

                    // If this is piece 7 and we received all 8 pieces
                    if (piece == 7 && mtcPieceMask == 0xFF)
                    {
                        // Update format
                        mtcFormat = (mtcPieces[7] >> 1) & 3;

                        // Calculate new qframe number
                        let newQFrameNumber = smpteToQFrames(
                            mtcFormat,
                            (mtcPieces[6] & 0x0f) | ((mtcPieces[7] & 0x01) << 4),
                            (mtcPieces[4] & 0x0f) | ((mtcPieces[5] & 0x03) << 4),
                            (mtcPieces[2] & 0x0f) | ((mtcPieces[3] & 0x03) << 4),
                            (mtcPieces[0] & 0x0f) | ((mtcPieces[1] & 0x01) << 4),
                            0
                            ) + 8;  // transmission of current qframe started 2 frames ago, catch up.

                        // These should sync, display a warning if they don't
                        if (mtcQFrameNumber != newQFrameNumber)
                        {
                            console.log(`Unexpected SMPTE partial frame - jumping (${mtcQFrameNumber} != ${newQFrameNumber}) [${mtcPieces}]`);
                            mtcQFrameNumber = newQFrameNumber;
                        }

                        // Reset mask of received pieces
                        mtcPieceMask = 0;
                    }
                    
                    // Log time
                    mtcTime = qframesToSeconds(mtcFormat, mtcQFrameNumber);
                    logSmpteTime();

                    // Start playback on all MTC channels
                    if (!mtcWasPlaying)
                    {
                        forAllMtcLayers(x => x.onPlay());
                    }
                    break;
                }

                case MidiMessage.Sysex:
                {
                    // MMC Play/Pause/Stop
                    if (m.length == 6 && m[1] == 0x7f && m[3] == 6)
                    {
                        // MMC command message
                        let deviceId = m[2];
                        if (deviceId >= 0 && deviceId <= 16)
                        {
                            switch (m[4])
                            {
                                case MidiMmc.Play:
                                    if (deviceId == 0)
                                        channelStates.forEach(x => x.layers.forEach(y => y.play()));
                                    else
                                        channelStates[deviceId-1].layers.forEach(y => y.play());
                                    break;
            
                                case MidiMmc.Pause:
                                    if (deviceId == 0)
                                        channelStates.forEach(x => x.layers.forEach(y => y.pause()));
                                    else
                                        channelStates[deviceId-1].layers.forEach(y => y.pause());
                                    break;
                    
                                case MidiMmc.Stop:
                                    if (deviceId == 0)
                                        channelStates.forEach(x => x.layers.forEach(y => y.stop()));
                                    else
                                        channelStates[deviceId-1].layers.forEach(y => y.stop());
                                    break;
                            }
                        }
                    }

                    // MTC Full Frame
                    if (m.length == 10 && m[1] == 0x7F && m[2] == 0x7f && m[3] == 1 && m[4] == 1)
                    {
                        let mtcWasPlaying = mtcIsPlaying;

                        // Update format
                        mtcFormat = (m[5] >> 5) & 0x03;

                        // Calculate new position
                        mtcQFrameNumber = smpteToQFrames(
                            mtcFormat, 
                            m[5] & 0x1f,    // Hours
                            m[6],           // Minutes
                            m[7],           // Seconds
                            m[8],           // Frames
                            0);             // QFrames

                        // No longer playing
                        mtcIsPlaying = false;

                        // Clear piece mask
                        mtcPieceMask = 0;

                        // Log it
                        mtcTime = qframesToSeconds(mtcFormat, mtcQFrameNumber);
                        logSmpteTime();
                        
                        // Pause all MTC channels
                        forAllMtcLayers(x => x.onPause());
                    }
                    break;
                }
            }
            return;
        }

        // Channel messages
        let channelIndex = m[0] & 0x0F;
        switch (m[0] & 0xF0)
        {
            case MidiMessage.ControlChange:
            {
                let channelState = channelStates[channelIndex];
                switch (m[1])
                {
                    case MidiController.BankSelectMsb:
                        channelState.bank = (channelState.bank & 0x7f) | ((m[2] & 0x7F) << 7);
                        break;

                    case MidiController.BankSelectLsb:
                        channelState.bank = (channelState.bank & (0x7f << 7)) | (m[2] & 0x7F)
                        break;

                }
                
                // Layer visibility control
                if (m[1] >= 80 && m[1] <= 89)
                {
                    let layerIndex = m[1] - 80;
                    if (layerIndex < channelState.layers.length)
                    {
                        let newDisplay = "visible";
                        switch (m[2])
                        {
                            case 0:
                                newDisplay = "inactive";
                                break;

                            case 1:
                                newDisplay = "hidden";
                                break;
                        }
                        if (channelState.layers[layerIndex].display != newDisplay)
                        {
                            channelState.layers[layerIndex].display = newDisplay;

                            // Broadcast
                            broadcast({
                                action: 'show',
                                channelIndex: channelIndex,
                                layerIndex: layerIndex,
                                display: newDisplay,
                            });                            
                        }
                    }
                }

                // Alternate program slots
                if (m[1] >= 70 && m[1] <= 73)
                {
                    OnProgramChange(channelIndex, m[1] - 70, m[2]);
                }
                break;
            }

            case MidiMessage.ProgramChange:
            {
                OnProgramChange(channelIndex, 0, m[1]);
                break;
            }
       }
    }
    catch (err)
    {
        console.error(err.message);
    }

});

function OnProgramChange(channelIndex, slot, programNumber, ignoreRedundant)
{
    // Must have a program list
    if (!programList)
    {
        console.log(`program change ignored (no program list loaded)`);
        return;
    }


    let channelState = channelStates[channelIndex];
    programNumber = (channelState.bank << 7) | programNumber;
    channelState.programNumberSlots[slot] = programNumber;

    for (let layerIndex=0; layerIndex < channelState.layers.length; layerIndex++)
    {
        let layerState = channelState.layers[layerIndex];

        // Only if layer uses program list and correct program slot
        if (!layerState.useProgramList || layerState.programSlot != slot)
            continue;

        // Work out  media file, quit if none
        let mediaFile = qualifyMediaFile(programList.getMediaFile(programNumber + layerState.programNumberOffset));

        // Don't fire if redundant
        if (ignoreRedundant && layerState.mediaFile == mediaFile)
            continue;
        
        // Store media file in channel state
        layerState.mediaFile = mediaFile;
        
        if (cl.verbose)
            console.log(`loading media file ${mediaFile} on ch ${channelIndex} layer ${layerIndex}`);
        
        // Broadcast load
        broadcast({
            action: 'loadLayer',
            channelIndex: channelIndex,
            layerIndex: layerIndex,
            layerState: layerState.render(),
        });
    }
}

// Open MIDI port
if (typeof(config.midiPort) === 'string')
{
    // Find MIDI port by name
    let opened = false;
    let midiPortCount = midiInput.getPortCount();
    for (let i=0; i<midiPortCount; i++)
    {
        if (midiInput.getPortName(i) === config.midiPort)
        {
            midiInput.openPort(i);
            opened = true;
            break;
        }
    }

    if (!opened)
        throw new Error(`MIDI port '${config.midiPort}' doesn't exist`);
}
else if (typeof(config.midiPort) === 'number')
{
    // Open MIDI port by index
    midiInput.openPort(config.midiPort);
}


// Start upp
let server = http.createServer(app);
let wss = new WebSocketServer({ 
    clientTracking: false, noServer: true
});


function onSocketError(err) 
{
    console.error(err);
}


// Handle http upgrade to socket request
server.on('upgrade', function (request, socket, head) {

    socket.on('error', onSocketError);
  
    sessionParser(request, {}, () => {
  
        socket.removeListener('error', onSocketError);
    
        wss.handleUpgrade(request, socket, head, function (ws) {
            wss.emit('connection', ws, request);
        });
    });
});

// Handle new socket connection
wss.on('connection', function (ws, request) {

    if (cl.verbose)
        console.log(`new socket connection (count=${sockets.length})`);
    sockets.push(ws);

    ws.on('message', function(data) {
        let msg = JSON.parse(data.toString('utf8'));
        switch (msg.action)
        {
            case 'setChannel':
                // Client is asking for the channel states for a set of channels
                ws.send(JSON.stringify({ 
                    action: 'loadChannel', 
                    channelIndex: msg.channelIndex,
                    channelState: channelStates[msg.channelIndex].render(),
                }));
                ws.channelIndex = msg.channelIndex;
                break;
        }
    });

    ws.on('error', console.error);
  
    ws.on('close', function () {
        sockets.splice(sockets.indexOf(ws), 1);
        if (cl.verbose)
            console.log(`socket connection closed (count=${sockets.length})`);
    });
});
  
// Start the server.
server.listen(config.port || 3000, config.host, function () {
    console.log(`Server running on [${server.address().address}]:${server.address().port} (${server.address().family})`);
});


// Helper to broadcast socket message
function broadcast(msg)
{
    msg = JSON.stringify(msg);
    if (cl.verbose)
        console.log("WebSocket Broadcast:", msg);

    // Broadcast
    for (let i=0; i<sockets.length; i++)
    {
        let ws = sockets[i];

        // Don't broadcast channel specific messages to sockets that aren't interested
        if (msg.channelIndex === undefined || ws.channelIndex == msg.channelIndex)
        {
            ws.send(msg);
        }
    }
}


// MTC and Master mode video sync broadcast
// Every 1 second, broadcast a sync event to all playing
// media streams reporting the current play position
setInterval(function() {
    for (let i=0; i<sockets.length; i++)
    {
        let ws = sockets[i];
        if (ws.channelIndex === undefined)
            continue;
        let timestamps = [];
        let channelState = channelStates[ws.channelIndex];
        for (let layerIndex = 0; layerIndex<channelState.layers.length; layerIndex++)
        {
            let layerState = channelState.layers[layerIndex];
            if (layerState.isPlaying && layerState.currentTime != null)
            {
                timestamps.push({
                    channelIndex: channelState.channelIndex,
                    layerIndex: layerIndex,
                    timestamp: layerState.currentTime,
                })
            }
        }
        if (timestamps.length > 0)
        {
            ws.send(JSON.stringify({
                action: 'sync',
                timestamps,
            }));
        }
    }
}, 1000);


// Graceful shutdown handlers
function gracefulClose(signal) {
    if (cl.verbose)
        console.log(`Received ${signal}`);

    midiInput.closePort();
    for (let i=0; i<sockets.length; i++)
        sockets[i].close();
    server.closeAllConnections();
    server.close( () => { 
        if (cl.verbose)
            console.log('Server closed.') 
    } );
}
process.on('SIGINT', gracefulClose);
process.on('SIGTERM', gracefulClose);
  

// Utility to qualify media file path
function qualifyMediaFile(mediaFile)
{
    if (!mediaFile)
        return mediaFile;

    if (mediaFile.indexOf("://") > 0)
        return mediaFile;

    if (mediaFile.startsWith("/"))
        mediaFile = mediaFile.substring(1);
    return "/media/" + mediaFile;
}

function logSmpteTime()
{
    process.stdout.write(formatSmpte(qframesToSmpte(mtcFormat, mtcQFrameNumber)) + '\r');
}

