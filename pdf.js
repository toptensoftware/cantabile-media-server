import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import child_process from 'node:child_process';

const gs_path = "C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe";

function pageCount(file)
{
    // Run GhostScript
    var child = child_process.spawnSync(
        gs_path, 
        [ '-q', '-dNODISPLAY', '-dPDFINFO', file, '-c', 'quit' ],
        { encoding : 'utf8' });
    
    // Parse output, looking for "File has NN pages"
    for (let line of child.stderr.split('\n'))
    {
        let match = line.match(/File has (\d+) page/);
        if (match)
            return parseInt(match[1]);
    }

    return -1;
}

function hashstring(str)
{
    return crypto.createHash('md5').update(str).digest("hex");
}

export function pdfMiddleware(baseDir)
{
    return function(req, res, next)
    {
        let file = decodeURIComponent(req.path);

        // Must be PDF file
        if (!file.toLowerCase().endsWith(".pdf"))
            return next();

        // Don't allow escaping media directory
        if (file.indexOf("..")>=0)
            return next();

        // Must have a page number specified
        if (req.query.page === undefined)
            return next();
        let page = req.query.page ?? 1;

        // Qualify file
        file = path.join(baseDir, file.substring(1));

        // Stat the file
        let stat = fs.statSync(file);
        let hashdata = file + "//" + JSON.stringify(req.query) + "//" + stat.mtime.toISOString();
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
            `-r300`,
            `-sOutputFile=-`,
            file,
        ]);
        res.writeHead(200, { 
            'Content-Type': 'image/png',
            'Etag': etag,
        });

        /*
        let proc = child_process.spawn(gs_path, [
            "-sstdout=%stderr",
            "-dNOPAUSE",
            "-dBATCH", 
            "-sDEVICE=jpeg",
            "-dJPEGQ=70",
            "-dTextAlphaBits=4",
            "-dGraphicsAlphaBits=4",
            `-dFirstPage=${page}`,
            `-dLastPage=${page}`,
            `-r300`,
            `-sOutputFile=-`,
            file,
        ]);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
*/
        // Send rendered page to response
        proc.stdout.pipe(res);

        /*
        let done = false;
        proc.on('exit', (code, signal) => {
            if(!done)
            {
                done = true;
                if (signal)
                if(code !== null){
                    resolve(code);
                } else {
                    reject(signal);
                }
            }
        });
        process.on('error', (err)=>{
            if(!done){
                done = true;
                reject(err);
            }
        });
        */
    }
}