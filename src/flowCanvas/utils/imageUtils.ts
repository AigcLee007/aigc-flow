/**
 * Image processing utilities for Flow Canvas
 */

// URL -> Blob
export async function imageUrlToBlob(url: string): Promise<Blob> {
  if (url.startsWith('data:')) {
    const [header, payload = ''] = url.split(',', 2);
    const mime = header.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream';
    const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  return await response.blob();
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// URL -> Base64
export async function imageUrlToBase64(url: string): Promise<string> {
  const blob = await imageUrlToBlob(url);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Canvas -> Blob URL
export function canvasToBlobUrl(canvas: HTMLCanvasElement, type = 'image/png', quality = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error('Canvas to Blob conversion failed'));
        }
      },
      type,
      quality
    );
  });
}

// Download Image
export async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const blob = await imageUrlToBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
  } catch (err) {
    console.error('Download failed:', err);
    // Fallback: try opening in new tab
    window.open(url, '_blank');
  }
}

// Get Natural Size
export function getImageNaturalSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Help with CORS if applicable
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = url;
  });
}
