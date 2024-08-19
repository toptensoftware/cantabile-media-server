import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function showVersion()
{
    let pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')), "utf8");

    console.log(`cantabile-media-server ${pkg.version}`);
    console.log("Copyright (C) 2024 Topten Software. All Rights Reserved");
}

function showHelp()
{
    showVersion();
    console.log("");
    console.log("Usage: cantabile-media-server [options]");
    console.log("");
    console.log("Options:");
    console.log("   --list-midi-devices      Shows a list of available midi devices");
    console.log("   --watch                  Watch and automatically reload program list file when changed");
    console.log("   --verbose                Shows more logging");
    console.log("   --help                   Shows this help");
    console.log("   --version                Shows version info");
}

export function parseCommandLine(args)
{
    var options = {
        verbose: false,
        listMidiDevices: false,
    }
    
    // Check command line args
    for (var i=2; i<args.length; i++)
    {
        var a = args[i];
        if (a.startsWith("--"))
        {
            var parts = a.substring(2).split(':');
            switch (parts[0])
            {
                case "list-midi-devices":
                    options.listMidiDevices = true;
                    break;

                case "watch":
                    options.watch = true;
                    break;
                    
                case "verbose":
                    options.verbose = true;
                    break;
    
                case "help":
                    showHelp();
                    process.exit(0);
    
                case "version":
                    showVersion();
                    process.exit(0);
    
                default:
                    throw new Error(`Unknown command line arg: ${args[i]}`);
            }
        }
        else
        {
            throw new Error(`Unknown command line arg: ${args[i]}`);
        }
    }
    

    return options;
}