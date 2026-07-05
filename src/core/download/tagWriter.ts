import { writeMetadata, writePic } from '@/utils/localMediaMetadata'
import { downloadFile, unlink, existsFile, temporaryDirectoryPath, moveFile } from '@/utils/fs'

interface TagData {
  name: string
  singer: string
  albumName: string
  picUrl?: string | null
}

const writeMetadataToPath = async(filePath: string, tagData: TagData): Promise<void> => {
  await writeMetadata(filePath, {
    name: tagData.name,
    singer: tagData.singer,
    albumName: tagData.albumName,
  })

  if (!tagData.picUrl) return

  let picPath: string | null = null
  try {
    picPath = `${temporaryDirectoryPath}/download_cover_${Date.now()}.jpg`
    const { promise } = downloadFile(tagData.picUrl, picPath, {
      connectionTimeout: 10000,
      readTimeout: 15000,
    })
    await promise
    if (await existsFile(picPath)) {
      await writePic(filePath, picPath)
    }
  } catch {
    // Cover art embedding failure is non-fatal
  } finally {
    if (picPath) void unlink(picPath).catch(() => {})
  }
}

export const writeTagsToFile = async(filePath: string, tagData: TagData): Promise<void> => {
  if (filePath.startsWith('content://')) {
    // SAF URI: native metadata module doesn't support content:// URIs
    // Copy to temp, write tags there, then move back
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1)
    const tempPath = `${temporaryDirectoryPath}/tag_${Date.now()}_${fileName}`
    try {
      await moveFile(filePath, tempPath)
      await writeMetadataToPath(tempPath, tagData)
      await moveFile(tempPath, filePath)
    } catch {
      // If tag writing failed, try to move the file back as-is
      try {
        if (await existsFile(tempPath) && !await existsFile(filePath)) {
          await moveFile(tempPath, filePath)
        }
      } catch {
        // If move back also fails, the file stays in temp - non-fatal
      }
    }
  } else {
    await writeMetadataToPath(filePath, tagData)
  }
}
