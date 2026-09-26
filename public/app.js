const urlInput =
    document.getElementById("urlInput");

const previewBtn =
    document.getElementById("previewBtn");

const pasteBtn =
    document.getElementById("pasteBtn");

const status =
    document.getElementById("status");

const result =
    document.getElementById("result");

const thumbnail =
    document.getElementById("thumbnail");

const title =
    document.getElementById("title");

const channel =
    document.getElementById("channel");

const downloadBtn =
    document.getElementById("downloadBtn");


let currentUrl = "";


function setStatus(message, type = "") {

    status.textContent = message;

    status.className =
        `status ${type}`;

}


function validYouTubeUrl(value) {

    try {

        const url = new URL(value);

        return [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "youtu.be"
        ].includes(url.hostname);

    } catch {

        return false;

    }

}


pasteBtn.addEventListener(
    "click",
    async () => {

        try {

            const text =
                await navigator.clipboard.readText();

            urlInput.value = text;

            urlInput.focus();

            setStatus(
                "Link pasted. Click Preview."
            );

        } catch {

            setStatus(
                "Clipboard access was blocked. Paste the link manually.",
                "error"
            );

        }

    }
);


previewBtn.addEventListener(
    "click",
    async () => {

        const url =
            urlInput.value.trim();


        if (!validYouTubeUrl(url)) {

            setStatus(
                "Please paste a valid YouTube link.",
                "error"
            );

            return;

        }


        previewBtn.disabled = true;

        previewBtn.textContent =
            "Loading...";

        result.classList.add("hidden");

        setStatus(
            "Fetching video information..."
        );


        try {

            const response =
                await fetch("/api/preview", {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        url
                    })

                });


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Preview failed."
                );

            }


            currentUrl = url;

            thumbnail.src =
                data.thumbnail;

            title.textContent =
                data.title;

            channel.textContent =
                `@${data.channel}`;


            result.classList.remove(
                "hidden"
            );


            setStatus(
                "Preview ready.",
                "success"
            );


            result.scrollIntoView({
                behavior: "smooth"
            });


        } catch (error) {

            setStatus(
                error.message,
                "error"
            );

        } finally {

            previewBtn.disabled = false;

            previewBtn.textContent =
                "Preview";

        }

    }
);


downloadBtn.addEventListener(
    "click",
    async () => {

        if (!currentUrl) return;


        downloadBtn.disabled = true;

        downloadBtn.innerHTML =
            "<span>⏳</span> Preparing HD...";


        setStatus(
            "Preparing your HD download..."
        );


        try {

            const response =
                await fetch("/api/download", {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        url: currentUrl
                    })

                });


            if (!response.ok) {

                const data =
                    await response
                        .json()
                        .catch(() => ({}));

                throw new Error(
                    data.error ||
                    "Download failed."
                );

            }


            const blob =
                await response.blob();


            const objectUrl =
                URL.createObjectURL(blob);


            const link =
                document.createElement("a");


            link.href =
                objectUrl;

            link.download =
                "youtube-short-hd.mp4";


            document.body.appendChild(link);

            link.click();

            link.remove();


            URL.revokeObjectURL(
                objectUrl
            );


            setStatus(
                "Download ready.",
                "success"
            );


        } catch (error) {

            setStatus(
                error.message,
                "error"
            );

        } finally {

            downloadBtn.disabled = false;

            downloadBtn.innerHTML =
                "<span>↓</span> Download HD";

        }

    }
);


urlInput.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {
            previewBtn.click();
        }

    }
);