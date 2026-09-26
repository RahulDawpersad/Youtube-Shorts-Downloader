import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;

const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
const PUBLIC_DIR = path.join(__dirname, "public");

// bgutil yt-dlp PO Token Provider
const BGUTIL_SERVER_HOME =
    process.env.BGUTIL_SERVER_HOME ||
    "/opt/render/project/src/bgutil-provider/server";

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));

function extractVideoId(input) {
    try {
        const url = new URL(input);
        const hostname = url.hostname.toLowerCase();

        if (hostname === "youtu.be") {
            const id = url.pathname
                .replace(/^\/+/, "")
                .split("/")[0];

            return id || null;
        }

        if (
            hostname === "youtube.com" ||
            hostname === "www.youtube.com" ||
            hostname === "m.youtube.com"
        ) {
            const videoId = url.searchParams.get("v");

            if (videoId) {
                return videoId;
            }

            const parts = url.pathname
                .split("/")
                .filter(Boolean);

            if (
                parts[0] === "shorts" ||
                parts[0] === "embed" ||
                parts[0] === "live"
            ) {
                return parts[1] || null;
            }
        }

        return null;
    } catch {
        return null;
    }
}

function buildYouTubeUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        console.log("");
        console.log("========================================");
        console.log("RUNNING YT-DLP");
        console.log("========================================");
        console.log("yt-dlp:", YT_DLP_PATH);
        console.log("FFmpeg:", FFMPEG_PATH);
        console.log("PO Token Provider:", BGUTIL_SERVER_HOME);
        console.log("Arguments:", args);

        const process = spawn(YT_DLP_PATH, args);

        let stdout = "";
        let stderr = "";

        process.stdout.on("data", (data) => {
            const output = data.toString();

            stdout += output;

            output
                .split("\n")
                .filter(Boolean)
                .forEach((line) => {
                    console.log(`[yt-dlp] ${line}`);
                });
        });

        process.stderr.on("data", (data) => {
            const output = data.toString();

            stderr += output;

            output
                .split("\n")
                .filter(Boolean)
                .forEach((line) => {
                    console.log(`[yt-dlp] ${line}`);
                });
        });

        process.on("error", (error) => {
            console.error("Failed to start yt-dlp:", error);
            reject(error);
        });

        process.on("close", (code) => {
            console.log("yt-dlp exited with code", code);

            if (code === 0) {
                resolve({
                    stdout,
                    stderr
                });
            } else {
                const error = new Error(
                    stderr ||
                    stdout ||
                    `yt-dlp exited with code ${code}`
                );

                error.code = code;

                reject(error);
            }
        });
    });
}

/*
========================================
PREVIEW
========================================
*/

app.post("/api/preview", async (req, res) => {
    const inputUrl = req.body.url;

    console.log("");
    console.log("========================================");
    console.log("PREVIEW REQUEST");
    console.log("========================================");
    console.log("URL:", inputUrl);

    if (!inputUrl) {
        return res.status(400).json({
            success: false,
            error: "Please provide a YouTube URL."
        });
    }

    const videoId = extractVideoId(inputUrl);

    if (!videoId) {
        return res.status(400).json({
            success: false,
            error: "Invalid YouTube URL."
        });
    }

    const youtubeUrl = buildYouTubeUrl(videoId);

    try {
        const result = await runYtDlp([
            "--dump-single-json",
            "--no-playlist",
            "--skip-download",

            // JavaScript runtime
            "--js-runtimes",
            "node",

            // bgutil PO Token Provider
            "--extractor-args",
            `youtubepot-bgutilscript:server_home=${BGUTIL_SERVER_HOME}`,

            youtubeUrl
        ]);

        const info = JSON.parse(result.stdout);

        return res.json({
            success: true,
            thumbnail:
                info.thumbnail ||
                `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            title: info.title || "YouTube Video",
            channel: info.uploader || "",
            duration: info.duration || 0,
            videoId
        });
    } catch (error) {
        console.error("");
        console.error("========================================");
        console.error("PREVIEW FAILED");
        console.error("========================================");
        console.error(error.message);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Unable to retrieve video information."
        });
    }
});

/*
========================================
DOWNLOAD
========================================
*/

app.post("/api/download", async (req, res) => {
    const inputUrl = req.body.url;

    console.log("");
    console.log("========================================");
    console.log("DOWNLOAD REQUEST");
    console.log("========================================");
    console.log("URL:", inputUrl);

    if (!inputUrl) {
        return res.status(400).json({
            success: false,
            error: "Please provide a YouTube URL."
        });
    }

    const videoId = extractVideoId(inputUrl);

    if (!videoId) {
        return res.status(400).json({
            success: false,
            error: "Invalid YouTube URL."
        });
    }

    const youtubeUrl = buildYouTubeUrl(videoId);

    const filename = `youtube_${videoId}_${Date.now()}.mp4`;
    const outputPath = path.join(DOWNLOAD_DIR, filename);

    try {
        await runYtDlp([
            "--no-playlist",

            // JavaScript runtime
            "--js-runtimes",
            "node",

            // bgutil PO Token Provider
            "--extractor-args",
            `youtubepot-bgutilscript:server_home=${BGUTIL_SERVER_HOME}`,

            // FFmpeg
            "--ffmpeg-location",
            FFMPEG_PATH,

            // Video format
            "-f",
            "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",

            "--merge-output-format",
            "mp4",

            "-o",
            outputPath,

            youtubeUrl
        ]);

        if (!fs.existsSync(outputPath)) {
            throw new Error(
                "Download completed but the output file was not found."
            );
        }

        const stats = fs.statSync(outputPath);

        if (stats.size === 0) {
            throw new Error("Downloaded file is empty.");
        }

        console.log("");
        console.log("========================================");
        console.log("DOWNLOAD SUCCESS");
        console.log("========================================");
        console.log("File:", outputPath);
        console.log("Size:", stats.size);

        res.download(outputPath, filename, (error) => {
            if (error) {
                console.error(
                    "File download error:",
                    error.message
                );
            }

            setTimeout(() => {
                fs.unlink(outputPath, (unlinkError) => {
                    if (unlinkError) {
                        console.error(
                            "Could not delete temporary file:",
                            unlinkError.message
                        );
                    } else {
                        console.log(
                            "Temporary file deleted:",
                            filename
                        );
                    }
                });
            }, 5000);
        });
    } catch (error) {
        console.error("");
        console.error("========================================");
        console.error("DOWNLOAD FAILED");
        console.error("========================================");
        console.error(error.message);

        if (fs.existsSync(outputPath)) {
            try {
                fs.unlinkSync(outputPath);
            } catch (cleanupError) {
                console.error(
                    "Cleanup error:",
                    cleanupError.message
                );
            }
        }

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Download failed."
        });
    }
});

/*
========================================
HEALTH CHECK
========================================
*/

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

/*
========================================
API 404
========================================
*/

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        error: "API endpoint not found."
    });
});

/*
========================================
ERROR HANDLER
========================================
*/

app.use((error, req, res, next) => {
    console.error("Unhandled server error:", error);

    res.status(500).json({
        success: false,
        error: "Internal server error."
    });
});

/*
========================================
START SERVER
========================================
*/

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("========================================");
    console.log("YouTube Shorts Downloader");
    console.log("========================================");
    console.log(`Server running on port ${PORT}`);
    console.log("yt-dlp:", YT_DLP_PATH);
    console.log("FFmpeg:", FFMPEG_PATH);
    console.log("JavaScript runtime: node");
    console.log("PO Token Provider:", BGUTIL_SERVER_HOME);
    console.log("Downloads:", DOWNLOAD_DIR);
    console.log("========================================");
});
