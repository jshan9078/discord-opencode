/**
 * Handles downloading and converting Discord image attachments to WebP.
 */
import sharp from "sharp"

export interface DiscordAttachment {
  url: string
  filename: string
  contentType?: string
}

export interface ProcessedImage {
  originalUrl: string
  filename: string
  webpPath: string
  width: number
  height: number
  sizeBytes: number
  originalSizeBytes: number
}

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/webp",
])

function isImageAttachment(attachment: DiscordAttachment): boolean {
  return Boolean(attachment.contentType && SUPPORTED_IMAGE_TYPES.has(attachment.contentType))
}

function generateImagePath(attachment: DiscordAttachment, index: number): string {
  const ext = ".webp"
  const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(ext, "")
  const timestamp = Date.now()
  return `/vercel/sandbox/images/${timestamp}-${index}-${safeName}${ext}`
}

export async function downloadAndConvertImage(
  attachment: DiscordAttachment,
  targetPath: string,
): Promise<ProcessedImage> {
  const response = await fetch(attachment.url)

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes (max ${MAX_IMAGE_SIZE_BYTES})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large: ${buffer.length} bytes (max ${MAX_IMAGE_SIZE_BYTES})`)
  }

  const webpBuffer = await sharp(buffer)
    .webp({ quality: 85 })
    .toBuffer()

  const metadata = await sharp(webpBuffer).metadata()

  return {
    originalUrl: attachment.url,
    filename: attachment.filename,
    webpPath: targetPath,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    sizeBytes: webpBuffer.length,
    originalSizeBytes: buffer.length,
  }
}

export async function processDiscordAttachments(
  attachments: DiscordAttachment[],
): Promise<ProcessedImage[]> {
  const imageAttachments = attachments.filter(isImageAttachment)
  const results: ProcessedImage[] = []

  for (let i = 0; i < imageAttachments.length; i++) {
    const attachment = imageAttachments[i]
    const targetPath = generateImagePath(attachment, i)

    try {
      const processed = await downloadAndConvertImage(attachment, targetPath)
      results.push(processed)
      console.info("image.processed", {
        originalUrl: attachment.url,
        webpPath: processed.webpPath,
        originalSize: processed.originalSizeBytes,
        processedSize: processed.sizeBytes,
      })
    } catch (error) {
      console.error("image.processing_failed", {
        url: attachment.url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}
