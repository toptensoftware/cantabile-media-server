// Helpers for working with SMPTE time code formats.

// Look up table for Frames Per Second for SMPTE formats
// 0=24fps, 1=25fps, 2=30fps(df) 3=30fps
// (drop-frame format not really supported and treated the same as 30fps)
let fps_for_format = [24, 25, 30, 30];

// Convert an smpte time into a total number of qframes
export function smpteToQFrames(format, hour, minute, second, frame, qframes)
{
    return ((second + (minute * 60) + (hour * 3600)) * fps_for_format[format] + frame) * 4 + qframes;
}

// Convert a qframe number into elapsed seconds
export function qframesToSeconds(format, qframeNumber)
{
    let fps = fps_for_format[format];
    let totalSeconds = Math.floor(qframeNumber / (4 * fps));
    let qframes = qframeNumber % (4 * fps);
    let frac = qframes / (4 * fps)
    return totalSeconds + frac;
}

// Convert a qframe number into an smpte time
export function qframesToSmpte(format, qframeNumber)
{
    let fps = fps_for_format[format];
    let totalSeconds = Math.floor(qframeNumber / (4 * fps));
    let qframes = qframeNumber % (4 * fps);

    return {
        format: format,
        seconds: totalSeconds % 60,
        minutes: Math.floor(totalSeconds / 60) % 60,
        hours: Math.floor(totalSeconds / 3600),
        frames:  Math.floor(qframes / 4),
        qframes: qframes % 4
    }
}

// Format an smpte object into a string of format hh:mm:ss:ff.q
// (where q is quarter frame counter 0..3)
export function formatSmpte(smpte)
{
    return `${smpte.hours.toString().padStart(2,'0')}:${smpte.minutes.toString().padStart(2,'0')}:${smpte.seconds.toString().padStart(2,'0')}:${smpte.frames.toString().padStart(2,'0')}.${smpte.qframes}`;
}

