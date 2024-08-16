#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import midi from '@julusian/midi';
import { WebSocketServer } from 'ws';
import { ProgramList } from './programList.js';
import { MidiMessage, MidiController, MidiMmc } from './midiTypes.js';
import { mimeTypeFromFile } from './mimeTypes.js';
    
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// App State
let app = express(); 
let sockets = [];
let programList = null;

// Load config
let config = JSON.parse(fs.readFileSync("config.json", "utf8"));
console.log(config);

// Load program list
if (config.programList !== undefined)
{
    programList = new ProgramList(config.programList);
}

// Setup initial state of each channel
let initialMediaFile = programList == null ? null : qualifyMediaFile(programList.getMediaFile(0));
let initialMimeType = mimeTypeFromFile(initialMediaFile);
let channelStates = [...Array(16)].map(function () { return  { 
    bank: 0,
    mediaFile: initialMediaFile,
    mimeType: initialMimeType,
}});


// Setup express
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

// Request from web browser to get current state of a channel
app.get('/channelState/:channel', (req, res) => {

    let channel = parseInt(req.params.channel);
    if (channel < 0 && channel > 15)
        throw new Error("Invalid channel number");

    res.json(channelStates[channel]);
});

// List available midi ports
let midiInput = new midi.Input();
let midiPortCount = midiInput.getPortCount();
console.log("Available MIDI ports:");
for (let i=0; i<midiPortCount; i++)
{
    console.log(`  ${i}: ${midiInput.getPortName(i)}`);
}

// Don't ignore sys-ex
midiInput.ignoreTypes(false, true, true);

// MIDI message handler
midiInput.on('message', (deltaTime, m) => {

    try
    {
        let channel = m[0] & 0x0F;
        switch (m[0] & 0xF0)
        {
            case MidiMessage.ControlChange:
            {
                let channelState = channelStates[channel];
                switch (m[1])
                {
                    case MidiController.BankSelectMsb:
                        channelState.bank = (channelState.bank & 0x7f) | ((m[2] & 0x7F) << 7);
                        break;

                    case MidiController.BankSelectLsb:
                        channelState.bank = (channelState.bank & (0x7f << 7)) | (m[2] & 0x7F)
                        break;
                }
                break;
            }

            case MidiMessage.ProgramChange:
            {
                OnProgramChange(channel, m[1]);
                break;
            }

            case 0xF0:
                switch (m[0])
                {
                    case MidiMessage.Sysex:
                        if (m.length == 6 && m[1] == 0x7f && m[3] == 6)
                        {
                            // MMC command message
                            let deviceId = m[2];
                            switch (m[4])
                            {
                                case MidiMmc.Play:
                                    broadcast({ action: 'play', channel: deviceId-1});
                                    break;
            
                                case MidiMmc.Pause:
                                    broadcast({ action: 'pause', channel: deviceId-1});
                                    break;
                    
                                case MidiMmc.Stop:
                                    broadcast({ action: 'stop', channel: deviceId-1});
                                    break;
                            }
                        }
                        break;
                }
                break;
        }
    }
    catch (err)
    {
        console.log(err);
    }

});

function OnProgramChange(channel, programNumber)
{
    let channelState = channelStates[channel];

    programNumber = (channelState.bank << 7) | programNumber;

    console.log(`program change: ${programNumber} on ch ${channel}`);

    // Must have a program list
    if (!programList)
        return;

    // Get the media file, quit if none
    let mediaFile = programList.getMediaFile(programNumber);
    if (!mediaFile)
        return;

    // Store media file in channel state
    channelState.mediaFile = qualifyMediaFile(mediaFile);
    channelState.mimeType = mimeTypeFromFile(mediaFile);

    console.log(`loading program ${mediaFile} on ch ${channel}`);

    // Broadcast load
    broadcast({
        action: 'load',
        channel,
        channelState,
    });
}

// Open MIDI port
if (typeof(config.midiPort) === 'string')
{
    // Find MIDI port by name
    let opened = false;
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

    sockets.push(ws);

    ws.on('error', console.error);
  
    ws.on('close', function () {
        sockets.splice(sockets.indexOf(ws), 1);
    });
});
  
// Start the server.
let port = config.port || 3000;
server.listen(port, function () {
console.log(`Listening on port ${port}`);
});


// Helper to broadcast socket message
function broadcast(msg)
{
    msg = JSON.stringify(msg);
    console.log("BROADCAST:", msg);
    for (let i=0; i<sockets.length; i++)
    {
        sockets[i].send(msg);
    }
}

// Graceful shutdown handlers
function gracefulClose(signal) {
    console.log(`Received ${signal}`);
    midiInput.closePort();
    for (let i=0; i<sockets.length; i++)
        sockets[i].close();
    server.close( () => { console.log('HTTP(S) server closed') } );
}
process.on('SIGINT', gracefulClose);
process.on('SIGTERM', gracefulClose);
  

// Utility to qualify media file path
function qualifyMediaFile(mediaFile)
{
    if (mediaFile.indexOf("://") > 0)
        return mediaFile;

    if (mediaFile.startsWith("/"))
        mediaFile = mediaFile.substring(1);
    return "/media/" + mediaFile;
}

