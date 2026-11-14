export const maxPhotoBytes = 4 * 1024 * 1024;
const targetBytes = 4_000_000;
const maxEdge = 4096;

async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    let scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));

    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      let photo = await new Promise(resolve => canvas.toBlob(resolve, type, 0.92));
      if (!photo?.size) break;
      if (photo.size < targetBytes) return photo;
      // Some browsers fall back to PNG for WebP. Skip quality changes for that lossless output.
      if (photo.type !== "image/png") {
        photo = await new Promise(resolve => canvas.toBlob(resolve, type, 0.82));
        if (!photo?.size) break;
        if (photo.size < targetBytes) return photo;
      }
      // Encoded size roughly follows pixel area. Verify the estimate on the next pass.
      scale *= Math.min(0.9, 0.95 * Math.sqrt(targetBytes / photo.size));
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  throw new Error("Could not fit the photo within the upload limit.");
}

export async function preparePhoto(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || !file.size) {
    throw new Error("Choose a JPEG, PNG, WebP, or GIF image.");
  }
  if (file.size <= maxPhotoBytes) return file;
  try {
    return await resizePhoto(file);
  } catch {
    throw new Error("Could not resize this photo. Choose another image or try a smaller copy.");
  }
}
