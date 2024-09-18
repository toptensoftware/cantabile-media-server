import os from 'node:os';
import path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import child_process from 'node:child_process';

let gs_path = "gs";
let gs_resolution = 300;

export function pdfInit(config)
{
    gs_resolution = config.gs_resolution ?? 300;

    if (config.gs !== undefined)
    {
        gs_path = config.gs;
    }
    else
    {
        if (os.platform() == "win32")
        {
            gs_path = null;
            try
            {
                let pfdir = "C:\\Program Files\\gs";
                let dirs = fs.readdirSync(pfdir, { withFileTypes: true });
                let found = null;
                let found_mt = null;
                for (let dir of dirs)
                {
                    if (dir.isDirectory())
                    {
                        let file = path.join(pfdir, dir.name, "bin\\gswin64c.exe");
                        try
                        {
                            let s = fs.statSync(file);

                            // Remember the newest one
                            if (found == null || found_mt > s.mtimeMs)
                            {
                                found = file;
                                found_mt = s.mtimeMs;
                            }
                        }
                        catch { /* don't care */ }
                    }
                }

                if (found == null)
                    throw new Error(`unable to locate Ghostscript matching ${pfdir}\\*\\bin\\gswin64c.exe`);

                gs_path = found;
                console.log(`Found Ghostscript executable at ${found}`);
            }
            catch (err)
            {
                console.error(`WARNING: PDF support won't work due to: `);
                console.error(`  - unable to locate Ghostscript executable - ${err.message}.`);
            }
        }
    }

    if (gs_path != null)
    {
        console.log(`PDF rendering resolution: ${gs_resolution}`);
    }
}

function pageCount(file)
{
    return new Promise((resolve, reject) => {

        // Run Ghostscript
        var child = child_process.spawn(
            gs_path, 
            [ '-q', '-dNODISPLAY', '-dPDFINFO', file, '-c', 'quit' ],
            { encoding : 'utf8' });

        let stderr = "";
        child.stderr.on('data', (data) => {
            stderr += data;
        });

        let stdout = "";
        child.stdout.on('data', (data) => {
            stdout += data;
        });

        child.on('close', (code) => {

            if (code != 0)
                return reject(new Error(`gs returned error: ${code}`));

            // Parse output, looking for "File has NN pages"
            for (let line of stderr.split('\n'))
            {
                let match = line.match(/File has (\d+) page/);
                if (match)
                    return resolve(parseInt(match[1]));
            }

            reject(new Error("page count not found in gs output"));
        });

        child.on('error', reject);
    });
}

function hashstring(str)
{
    return crypto.createHash('md5').update(str).digest("hex");
}

export function pdfMiddleware(baseDir)
{
    return async function(req, res, next)
    {
        let file = decodeURIComponent(req.path);

        // Must be PDF file
        if (!file.toLowerCase().endsWith(".pdf"))
            return next();

        // Don't allow escaping media directory
        if (file.indexOf("..")>=0)
            return next();

        // Qualify file
        file = path.join(baseDir, file.substring(1));

        // Must have a page number specified
        if (req.query.page === undefined)
        {
            res.set('x-cantabile-media-server-page-count', await pageCount(file));
            return next();
        }
        let page = req.query.page ?? 1;

        // Stat the file
        let stat = await fsPromises.stat(file);
        let hashdata = `${file}//${gs_resolution}//${JSON.stringify(req.query)}//${stat.mtime.toISOString()}`;
        let etag = hashstring(hashdata);

        // Same e-tag
        if (req.headers['if-none-match'] == etag)
        {
            res.status(304);
            res.send("not modified");
            return;
        }

        // Run Ghostscript
        let proc = child_process.spawn(gs_path, [
            "-sstdout=%stderr",
            "-dNOPAUSE",
            "-dBATCH", 
            "-sDEVICE=png16m",
            "-dTextAlphaBits=4",
            "-dGraphicsAlphaBits=4",
            `-dFirstPage=${page}`,
            `-dLastPage=${page}`,
            `-r${gs_resolution}`,
            `-sOutputFile=-`,
            file,
        ]);
        res.writeHead(200, { 
            'Content-Type': 'image/png',
            'Etag': etag,
        });

        // Send rendered page to response
        proc.stdout.pipe(res);
    }
}