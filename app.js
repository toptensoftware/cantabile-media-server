#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import midi from '@julusian/midi';
import { WebSocketServer } from 'ws';
import { parseCommandLine } from './commandLine.js';
import { ProgramList } from './programList.js';
import { MidiMessage, MidiController, MidiMmc } from './midiTypes.js';
import { mimeTypeFromFile } from './mimeTypes.js';

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

// Load config
let config = JSON.parse(fs.readFileSync("config.json", "utf8"));
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
                    OnProgramChange(i, channelStates[i].programNumber, true);
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

// Setup initial state of each channel
let initialMediaFile = programList == null ? null : qualifyMediaFile(programList.getMediaFile(0));
let initialMimeType = mimeTypeFromFile(initialMediaFile);
let channelStates = [...Array(16)].map(function () { return  { 
    bank: 0,
    programNumber: 0,
    mediaFile: initialMediaFile,
    mimeType: initialMimeType,
}});


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

// Request from web browser to get current state of a channel
app.get('/channelState/:channel', (req, res) => {

    let channel = parseInt(req.params.channel);
    if (channel < 0 && channel > 15)
        throw new Error("Invalid channel number");

    res.json(channelStates[channel]);
});

// List available midi ports
let midiInput = new midi.Input();

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
        console.err(err.message);
    }

});

function OnProgramChange(channel, programNumber, ignoreRedundant)
{
    // Must have a program list
    if (!programList)
    {
        console.log(`program change ignored (no program list loaded)`);
        return;
    }


    let channelState = channelStates[channel];
    channelState.programNumber = programNumber;
    programNumber = (channelState.bank << 7) | programNumber;

    // Get the media file, quit if none
    let mediaFile = programList.getMediaFile(programNumber);
    if (!mediaFile)
    {
        console.log(`no media file selected for program number ${programNumber}`);
        return;
    }
    mediaFile = qualifyMediaFile(mediaFile);

    // Don't fire if redundant
    if (ignoreRedundant && channelState.mediaFile == mediaFile)
        return;

    // Store media file in channel state
    channelState.mediaFile = mediaFile;
    channelState.mimeType = mimeTypeFromFile(mediaFile);

    if (cl.verbose)
        console.log(`loading media file ${mediaFile} on ch ${channel}`);

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
    for (let i=0; i<sockets.length; i++)
    {
        sockets[i].send(msg);
    }
}

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
    if (mediaFile.indexOf("://") > 0)
        return mediaFile;

    if (mediaFile.startsWith("/"))
        mediaFile = mediaFile.substring(1);
    return "/media/" + mediaFile;
}

