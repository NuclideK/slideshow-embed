const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function linearPartition(sequence, numRows, imgList) {
  let minL = sequence.length - 1;
  if (numRows > minL) {
    return [imgList.slice()];
  }

  const solution = calculateLinearPartition(sequence, numRows);
  numRows -= 2;
  let answer = [];

  while (numRows >= 0) {
    const newAnswer = [];
    const start = solution[minL - 1][numRows];

    for (let i = start + 1; i <= minL; i++) {
      newAnswer.push(imgList[i]);
    }
    answer = [newAnswer, ...answer];
    minL = start;
    numRows -= 1;
  }

  const newAnswer = [];
  for (let i = 0; i <= minL; i++) {
    newAnswer.push(imgList[i]);
  }
  answer = [newAnswer, ...answer];

  return answer;
}

function calculateLinearPartition(sequence, numRows) {
  const numElements = sequence.length;
  const table = Array.from({ length: numElements }, () =>
    Array(numRows).fill(0)
  );
  const solution = Array.from({ length: numElements - 1 }, () =>
    Array(numRows - 1).fill(0)
  );

  for (let index = 0; index < numElements; index++) {
    if (index) {
      table[index][0] = sequence[index] + table[index - 1][0];
    } else {
      table[index][0] = sequence[index];
    }
  }

  for (let colIdx = 0; colIdx < numRows; colIdx++) {
    table[0][colIdx] = sequence[0];
  }

  for (let index = 1; index < numElements; index++) {
    for (let colIdx = 1; colIdx < numRows; colIdx++) {
      const optimalPartition = [];

      for (let x = 0; x < index; x++) {
        const max_value = Math.max(
          table[x][colIdx - 1],
          table[index][0] - table[x][0]
        );
        optimalPartition.push([max_value, x]);
      }

      const [minValue, minIndex] = optimalPartition.reduce((min, curr) =>
        curr[0] < min[0] ? curr : min
      );
      table[index][colIdx] = minValue;
      solution[index - 1][colIdx - 1] = minIndex;
    }
  }

  return solution;
}

function clamp(value, max) {
  return value < 1 ? 1 : value > max ? max : value;
}

function ensureEven(n) {
  return n % 2 === 0 ? n : n + 1;
}

async function initResizeImages(imgList) {
  return Promise.all(
    imgList.map(async (img) => {
      const resized = await sharp(img.buffer, { limitInputPixels: false })
        .resize({ height: initHeight, withoutEnlargement: true })
        .toBuffer();
      const metadata = await sharp(resized).metadata();
      return {
        buffer: resized,
        height: metadata.height,
        width: metadata.width,
      };
    })
  );
}

async function createCollage(imgList) {
  const resizedImages = await initResizeImages(imgList);

  const totalWidth = resizedImages.reduce((acc, img) => acc + img.width, 0);
  const avgWidth = totalWidth / resizedImages.length;
  const numRows = clamp(
    Math.round(totalWidth / (avgWidth * Math.sqrt(resizedImages.length))),
    resizedImages.length
  );
  let imgRows;

  if (numRows === 1) {
    imgRows = [resizedImages];
  } else if (numRows === resizedImages.length) {
    imgRows = resizedImages.map((img) => [img]);
  } else {
    const aspectRatios = resizedImages.map((img) =>
      Math.round((img.width / img.height) * 100)
    );
    imgRows = await linearPartition(aspectRatios, numRows, resizedImages);
  }

  const rowWidths = imgRows.map((row) =>
    row.reduce((acc, img) => acc + img.width, 0)
  );
  const minRowWidth = Math.min(...rowWidths);
  const rowWidthRatios = rowWidths.map((w) => minRowWidth / w);

  imgRows = await Promise.all(
    imgRows.map(async (row, index) => {
      return Promise.all(
        row.map(async (img) => {
          const newWidth = Math.round(img.width * rowWidthRatios[index]);
          const newHeight = Math.round(img.height * rowWidthRatios[index]);
          return {
            buffer: await sharp(img.buffer)
              .resize({ width: newWidth, height: newHeight })
              .toBuffer(),
            height: newHeight,
            width: newWidth,
          };
        })
      );
    })
  );

  const rowHeights = imgRows.map((row) =>
    Math.max(...row.map((img) => img.height))
  );
  const w = ensureEven(
    Math.min(
      ...imgRows.map((row) => row.reduce((acc, img) => acc + img.width, 0))
    )
  );
  const h = ensureEven(rowHeights.reduce((acc, height) => acc + height, 0));
  let x = 0;
  let y = 0;
  let imagePositions = [];
  for (const row of imgRows) {
    for (const img of row) {
      imagePositions.push({
        input: img.buffer,
        left: x,
        top: y,
      });
      x += img.width;
    }
    y += Math.max(...row.map((img) => img.height));
    x = 0;
  }
  let collage = sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: "rgb(0, 0, 0)",
    },
  }).composite(imagePositions);
  return await collage.jpeg().toBuffer();
}

async function makeCollage(images, output, widthArg, heightArg) {
  const start = Date.now();
  try {
    const imgObjects = await Promise.all(
      images.map(async (img) => {
        const imgBuffer = await sharp(img.filepath).toBuffer();
        const metadata = await sharp(imgBuffer).metadata();
        return {
          buffer: imgBuffer,
          height: metadata.height,
          width: metadata.width,
        };
      })
    );

    const collageBuffer = await createCollage(imgObjects, widthArg);
    const collage = sharp(collageBuffer);
    const metadata = await collage.metadata();
    let width = metadata.width;
    let height = metadata.height;

    if (width > widthArg) {
      width = widthArg;
      height = Math.round((metadata.height / metadata.width) * widthArg);
    } else if (height > heightArg) {
      height = heightArg;
      width = Math.round((metadata.width / metadata.height) * heightArg);
    }

    await collage
      .resize({ width: width, height: height })
      .toFile(`./collages/${output}`);
    return (Date.now() - start) / 1000;
  } catch (error) {
    console.error(error);
    return -1;
  }
}

const widthArg = 5000;
const heightArg = 5000;
const initHeight = 500;

module.exports = makeCollage;
