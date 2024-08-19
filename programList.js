import fs from 'node:fs';

export class ProgramList
{
    #map;
    #baseProgram;

    constructor(filename)
    {
        let lines = fs.readFileSync(filename, 'utf-8').split(/\r?\n/);

        this.#map = new Map();
        this.#baseProgram = 1;

        let lineNo = -1;
        try
        {
            for ( lineNo = 0; lineNo < lines.length; lineNo++)
            {
                let line = lines[lineNo].trim();

                // Ignore blank lines
                if (line.length == 0)
                    continue;

                // Ignore comment lines
                if (line[0] == '#')
                    continue;

                // Find separator
                let colonPos = line.indexOf(':');
                if (colonPos < 0)
                    throw new Error("syntax error (missing colon)");

                // Split into program number and media file name
                let programNumber = line.substring(0, colonPos).trim();
                let mediaFile = line.substring(colonPos + 1).trim();

                if (programNumber == 'default')
                {
                    this.#map.set(-1, mediaFile);
                }
                else if (programNumber == 'base')
                {
                    this.#baseProgram = parseInt(mediaFile);
                    if (this.#baseProgram != 0 && this.#baseProgram != 1)
                        throw new Error("base program number should be 0 or 1");
                }
                else
                {
                    // Store it
                    this.#map.set(ProgramList.parseProgramNumber(programNumber) - this.#baseProgram, mediaFile);
                }
            }
        }
        catch (err)
        {
            throw new Error(`${err.message} at line ${lineNo + 1}`);
        }
    }

    getMediaFile(programNumber)
    {
        // Look up map
        let mediaFile = this.#map.get(programNumber);

        // Use default if not found
        if (mediaFile === undefined)
            mediaFile = this.#map.get(-1);

        // Done
        return mediaFile;
    }

    static parseProgramNumber(str)
    {
        var parts = str.split('.').map(x => parseInt(x));
        let programNumber = 0;
        for (let p of parts)
        {
            programNumber = programNumber * 128 + p;
        }
        return programNumber;
    }
}