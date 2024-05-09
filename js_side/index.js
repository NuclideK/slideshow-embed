const http = require("http");
const formidable = require("formidable");
const fs = require("fs").promises;
const makeCollage = require("./collageMaker");

function parsePost(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      } else {
        const images = Array.isArray(files.images)
          ? files.images
          : [files.images];
        const videoIdFile = files.video_id[0].filepath;
        resolve({ images, videoIdFile });
      }
    });
  });
}

async function handleCollageRequest(images, videoId) {
  if (images.length === 0) {
    throw new Error("No images provided");
  }
  const collageFilename = `collage-${videoId}.jpeg`;
  const timeTaken = await makeCollage(images, collageFilename);
  return `Collage created in ${timeTaken.toFixed(3)} seconds`;
}

function handleResizeRequest(images, videoId) {
  console.warn("makeResize() does not exist yet"); // womp womp, was this ever used anyway?
  return -1;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST") {
    if (req.url === "/collage" || req.url === "/resize") {
      try {
        const { images, videoIdFile } = await parsePost(req);
        const videoId = await fs
          .readFile(videoIdFile, "utf8")
          .catch(() => "fallback"); // If no id detected just use "fallback"

        let responseMessage;

        if (req.url === "/collage") {
          responseMessage = await handleCollageRequest(images, videoId);
        } else if (req.url === "/resize") {
          responseMessage = handleResizeRequest(images, videoId);
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        console.log(responseMessage);
        res.end(responseMessage);
      } catch (err) {
        console.error(err);
        const statusCode = err instanceof Error ? 500 : 400;
        res.writeHead(statusCode, { "Content-Type": "text/plain" });
        res.end(err.message || "Internal Server Error");
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  } else {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
  }
});

const PORT = 9700;
server.listen(PORT, () => {
  console.log(`[NODE] Server running at http://localhost:${PORT}`);
});
