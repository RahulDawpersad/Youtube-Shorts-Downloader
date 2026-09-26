import express from "express";
import { spawn } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    statSync
} from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// ============================================================
// PATH SETUP
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// SERVER SETTINGS
// ============================================================

const app = express();

// Render provides PORT automatically.
// Local development falls back to 3000.
const PORT = process.env.PORT || 3000;

// ============================================================
// PROGRAM PATHS
// ============================================================

// On Windows/Linux these can be overridden with environment
// variables.
//
// Local:
//   yt-dlp
//   ffmpeg
//
// Render:
//   yt-dlp
//   ffmpeg

const YT_DLP_PATH =
    process.env.YT_DLP_PATH || "yt-dlp";

const FFMPEG_PATH =
    process.env.FFMPEG_PATH || "ffmpeg";

// ============================================================
// DOWNLOAD DIRECTORY
// ============================================================

const DOWNLOAD_DIR = path.join(
    __dirname,
    "downloads"
);

if (!existsSync(DOWNLOAD_DIR)) {
    mkdirSync(DOWNLOAD_DIR, {
        recursive: true
    });
}

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// ============================================================
// CHECK REQUIRED PROGRAMS
// ============================================================

function checkDependencies() {
    // We don't check existsSync() here because yt-dlp and
    // FFmpeg may be installed in the system PATH on Render.

    if (!YT_DLP_PATH) {
        throw new Error(
            "yt-dlp path is not configured."
        );
    }

    if (!FFMPEG_PATH) {
        throw new Error(
            "FFmpeg path is not configured."
        );
    }
}

// ============================================================
// EXTRACT YOUTUBE VIDEO ID
// ============================================================

function extractVideoId(input) {
    if (!input || typeof input !== "string") {
        return null;
    }

    try {
        const url = new URL(input.trim());

        const hostname =
            url.hostname.toLowerCase();

        // --------------------------------------------------------
        // youtu.be
        // --------------------------------------------------------

        if (hostname === "youtu.be") {
            const id = url.pathname
                .split("/")
                .filter(Boolean)[0];

            return id || null;
        }

        // --------------------------------------------------------
        // YouTube domains
        // --------------------------------------------------------

        const validHosts = [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com"
        ];

        if (!validHosts.includes(hostname)) {
            return null;
        }

        // --------------------------------------------------------
        // /watch?v=VIDEO_ID
        // --------------------------------------------------------

        if (url.pathname === "/watch") {
            return url.searchParams.get("v");
        }

        // --------------------------------------------------------
        // /shorts/VIDEO_ID
        // --------------------------------------------------------

        if (
            url.pathname.startsWith(
                "/shorts/"
            )
        ) {
            const parts =
                url.pathname
                    .split("/")
                    .filter(Boolean);

            return parts[1] || null;
        }

        // --------------------------------------------------------
        // /embed/VIDEO_ID
        // --------------------------------------------------------

        if (
            url.pathname.startsWith(
                "/embed/"
            )
        ) {
            const parts =
                url.pathname
                    .split("/")
                    .filter(Boolean);

            return parts[1] || null;
        }

        return null;
    } catch {
        return null;
    }
}

// ============================================================
// RUN YT-DLP
// ============================================================

function runYtDlp(args) {
    return new Promise(
        (resolve, reject) => {
            try {
                checkDependencies();
            } catch (error) {
                reject(error);
                return;
            }

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "RUNNING YT-DLP"
            );
            console.log(
                "========================================"
            );

            console.log(
                "yt-dlp:",
                YT_DLP_PATH
            );

            console.log(
                "FFmpeg:",
                FFMPEG_PATH
            );

            console.log(
                "Arguments:",
                args
            );

            console.log(
                "========================================"
            );

            const child =
                spawn(
                    YT_DLP_PATH,
                    args,
                    {
                        windowsHide: true
                    }
                );

            let stdout = "";
            let stderr = "";

            // ----------------------------------------------------
            // STDOUT
            // ----------------------------------------------------

            child.stdout.on(
                "data",
                (data) => {
                    const text =
                        data.toString();

                    stdout += text;

                    console.log(
                        `[yt-dlp] ${text.trimEnd()}`
                    );
                }
            );

            // ----------------------------------------------------
            // STDERR
            // ----------------------------------------------------

            child.stderr.on(
                "data",
                (data) => {
                    const text =
                        data.toString();

                    stderr += text;

                    console.error(
                        `[yt-dlp] ${text.trimEnd()}`
                    );
                }
            );

            // ----------------------------------------------------
            // PROCESS ERROR
            // ----------------------------------------------------

            child.on(
                "error",
                (error) => {
                    reject(
                        new Error(
                            `Could not start yt-dlp: ${error.message}`
                        )
                    );
                }
            );

            // ----------------------------------------------------
            // PROCESS COMPLETE
            // ----------------------------------------------------

            child.on(
                "close",
                (code) => {
                    console.log("");

                    console.log(
                        `yt-dlp exited with code ${code}`
                    );

                    if (code === 0) {
                        resolve({
                            stdout:
                                stdout.trim(),

                            stderr:
                                stderr.trim()
                        });

                        return;
                    }

                    const message =
                        stderr.trim() ||
                        stdout.trim() ||
                        `yt-dlp exited with code ${code}`;

                    reject(
                        new Error(message)
                    );
                }
            );
        }
    );
}

// ============================================================
// HOME PAGE
// ============================================================

app.get(
    "/",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );
    }
);

// ============================================================
// PREVIEW API
// ============================================================

app.post(
    "/api/preview",
    async (req, res) => {
        const inputUrl =
            req.body?.url;

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "PREVIEW REQUEST"
        );
        console.log(
            "========================================"
        );

        console.log(
            "URL:",
            inputUrl
        );

        const videoId =
            extractVideoId(
                inputUrl
            );

        if (!videoId) {
            return res.status(400).json({
                success: false,
                error:
                    "Please enter a valid YouTube URL."
            });
        }

        const youtubeUrl =
            `https://www.youtube.com/watch?v=${videoId}`;

        try {
            const result =
                await runYtDlp([
                    "--dump-single-json",
                    "--no-playlist",
                    "--skip-download",
                    youtubeUrl
                ]);

            const data =
                JSON.parse(
                    result.stdout
                );

            return res.json({
                success: true,

                id: videoId,

                title:
                    data.title ||
                    "YouTube Short",

                channel:
                    data.uploader ||
                    data.channel ||
                    "YouTube",

                duration:
                    data.duration ||
                    0,

                thumbnail:
                    data.thumbnail ||
                    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,

                webpage_url:
                    data.webpage_url ||
                    youtubeUrl
            });
        } catch (error) {
            console.error("");
            console.error(
                "========================================"
            );
            console.error(
                "PREVIEW FAILED"
            );
            console.error(
                "========================================"
            );
            console.error(
                error.message
            );
            console.error(
                "========================================"
            );

            return res.status(500).json({
                success: false,
                error:
                    "Could not retrieve video information.",
                details:
                    error.message
            });
        }
    }
);

// ============================================================
// DOWNLOAD API
// ============================================================

app.post(
    "/api/download",
    async (req, res) => {
        const inputUrl =
            req.body?.url;

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "DOWNLOAD REQUEST"
        );
        console.log(
            "========================================"
        );

        console.log(
            "URL:",
            inputUrl
        );

        const videoId =
            extractVideoId(
                inputUrl
            );

        if (!videoId) {
            return res.status(400).json({
                success: false,
                error:
                    "Please enter a valid YouTube URL."
            });
        }

        const youtubeUrl =
            `https://www.youtube.com/watch?v=${videoId}`;

        // --------------------------------------------------------
        // UNIQUE OUTPUT FILE
        // --------------------------------------------------------

        const randomName =
            crypto
                .randomBytes(8)
                .toString("hex");

        const outputPath =
            path.join(
                DOWNLOAD_DIR,
                `${randomName}.mp4`
            );

        console.log(
            "Video ID:",
            videoId
        );

        console.log(
            "Output:",
            outputPath
        );

        try {
            // ----------------------------------------------------
            // DOWNLOAD VIDEO + AUDIO
            // ----------------------------------------------------

            await runYtDlp([
                "--no-playlist",

                // FFmpeg location
                "--ffmpeg-location",
                FFMPEG_PATH,

                // Best MP4 video up to 1080p
                // + best M4A audio
                // with fallbacks
                "-f",
                "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",

                // Merge into MP4
                "--merge-output-format",
                "mp4",

                // Output
                "-o",
                outputPath,

                // YouTube URL
                youtubeUrl
            ]);

            // ----------------------------------------------------
            // CHECK FILE
            // ----------------------------------------------------

            if (!existsSync(outputPath)) {
                throw new Error(
                    "yt-dlp completed, but the final MP4 file was not created."
                );
            }

            const stats =
                statSync(
                    outputPath
                );

            if (stats.size <= 0) {
                throw new Error(
                    "The downloaded MP4 file is empty."
                );
            }

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "DOWNLOAD SUCCESSFUL"
            );
            console.log(
                "========================================"
            );

            console.log(
                "File:",
                outputPath
            );

            console.log(
                "Size:",
                `${stats.size} bytes`
            );

            console.log(
                "========================================"
            );

            // ----------------------------------------------------
            // SEND FILE
            // ----------------------------------------------------

            return res.download(
                outputPath,
                "youtube-short.mp4",
                (error) => {
                    // --------------------------------------------
                    // CLEANUP
                    // --------------------------------------------

                    setTimeout(
                        async () => {
                            try {
                                if (
                                    existsSync(
                                        outputPath
                                    )
                                ) {
                                    await unlink(
                                        outputPath
                                    );

                                    console.log(
                                        "Temporary file deleted."
                                    );
                                }
                            } catch (
                                cleanupError
                            ) {
                                console.error(
                                    "Cleanup error:",
                                    cleanupError.message
                                );
                            }
                        },
                        5000
                    );

                    // --------------------------------------------
                    // TRANSFER ERROR
                    // --------------------------------------------

                    if (error) {
                        console.error(
                            "Browser download error:",
                            error.message
                        );
                    }
                }
            );
        } catch (error) {
            console.error("");
            console.error(
                "========================================"
            );
            console.error(
                "DOWNLOAD FAILED"
            );
            console.error(
                "========================================"
            );

            console.error(
                error.message
            );

            console.error(
                "========================================"
            );

            // ----------------------------------------------------
            // DELETE PARTIAL FILE
            // ----------------------------------------------------

            try {
                if (
                    existsSync(
                        outputPath
                    )
                ) {
                    await unlink(
                        outputPath
                    );

                    console.log(
                        "Partial file deleted."
                    );
                }
            } catch (
                cleanupError
            ) {
                console.error(
                    "Cleanup error:",
                    cleanupError.message
                );
            }

            return res.status(500).json({
                success: false,
                error:
                    "Download failed.",
                details:
                    error.message
            });
        }
    }
);

// ============================================================
// API 404
// ============================================================

app.use(
    "/api",
    (req, res) => {
        res.status(404).json({
            success: false,
            error:
                "API endpoint not found."
        });
    }
);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
    (error, req, res, next) => {
        console.error(
            "GLOBAL SERVER ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            success: false,
            error:
                "Internal server error.",
            details:
                error.message
        });
    }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    () => {
        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "YouTube Shorts Downloader"
        );
        console.log(
            "========================================"
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            "yt-dlp:",
            YT_DLP_PATH
        );

        console.log(
            "FFmpeg:",
            FFMPEG_PATH
        );

        console.log(
            "Downloads:",
            DOWNLOAD_DIR
        );

        console.log(
            "========================================"
        );
    }
);
