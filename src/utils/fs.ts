import RNFS from 'react-native-fs'
import {
  Dirs,
  FileSystem,
  AndroidScoped,
  type OpenDocumentOptions,
  type Encoding,
  type HashAlgorithm,
  getExternalStoragePaths as _getExternalStoragePaths,
} from 'react-native-file-system'

export type {
  FileType,
} from 'react-native-file-system'

// export const externalDirectoryPath = RNFS.ExternalDirectoryPath

export const extname = (name: string) => name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1) : ''

export const temporaryDirectoryPath = Dirs.CacheDir
export const externalStorageDirectoryPath = Dirs.SDCardDir
export const privateStorageDirectoryPath = Dirs.DocumentDir

export const getExternalStoragePaths = async(is_removable?: boolean) => _getExternalStoragePaths(is_removable)

export const selectManagedFolder = async(isPersist: boolean = false) => AndroidScoped.openDocumentTree(isPersist)
export const selectFile = async(options: OpenDocumentOptions) => AndroidScoped.openDocument(options)
export const removeManagedFolder = async(path: string) => AndroidScoped.releasePersistableUriPermission(path)
export const getManagedFolders = async() => AndroidScoped.getPersistedUriPermissions()

export const getPersistedUriList = async() => AndroidScoped.getPersistedUriPermissions()


export const readDir = async(path: string) => FileSystem.ls(path)

export const unlink = async(path: string) => FileSystem.unlink(path)

export const mkdir = async(path: string) => FileSystem.mkdir(path)

export const stat = async(path: string) => FileSystem.stat(path)
export const hash = async(path: string, algorithm: HashAlgorithm) => FileSystem.hash(path, algorithm)

export const readFile = async(path: string, encoding?: Encoding) => FileSystem.readFile(path, encoding)


// export const copyFile = async(fromPath: string, toPath: string) => FileSystem.cp(fromPath, toPath)

export const moveFile = async(fromPath: string, toPath: string) => FileSystem.mv(fromPath, toPath)
export const gzipFile = async(fromPath: string, toPath: string) => FileSystem.gzipFile(fromPath, toPath)
export const unGzipFile = async(fromPath: string, toPath: string) => FileSystem.unGzipFile(fromPath, toPath)
export const gzipString = async(data: string, encoding?: Encoding) => FileSystem.gzipString(data, encoding)
export const unGzipString = async(data: string, encoding?: Encoding) => FileSystem.unGzipString(data, encoding)

export const existsFile = async(path: string) => FileSystem.exists(path)

export const rename = async(path: string, name: string) => FileSystem.rename(path, name)

export const writeFile = async(path: string, data: string, encoding?: Encoding) => FileSystem.writeFile(path, data, encoding)

export const appendFile = async(path: string, data: string, encoding?: Encoding) => FileSystem.appendFile(path, data, encoding)

export const downloadFile = (url: string, path: string, options: Omit<RNFS.DownloadFileOptions, 'fromUrl' | 'toFile'> = {}) => {
  if (!options.headers) {
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
    }
  }
  return RNFS.downloadFile({
    fromUrl: url, // URL to download file from
    toFile: path, // Local filesystem path to save the file to
    ...options,
    headers: options.headers, // An object of headers to be passed to the server
    // // background?: boolean;     // Continue the download in the background after the app terminates (iOS only)
    // // discretionary?: boolean;  // Allow the OS to control the timing and speed of the download to improve perceived performance  (iOS only)
    // // cacheable?: boolean;      // Whether the download can be stored in the shared NSURLCache (iOS only, defaults to true)
    // progressInterval: options.progressInterval,
    // progressDivider: options.progressDivider,
    // begin: (res: DownloadBeginCallbackResult) => void;
    // progress?: (res: DownloadProgressCallbackResult) => void;
    // // resumable?: () => void;    // only supported on iOS yet
    // connectionTimeout?: number // only supported on Android yet
    // readTimeout?: number       // supported on Android and iOS
    // // backgroundTimeout?: number // Maximum time (in milliseconds) to download an entire resource (iOS only, useful for timing out background downloads)
  })
}

export const stopDownload = (jobId: number) => {
  RNFS.stopDownload(jobId)
}


// ==================== Save Path Diagnostics ====================
/**
 * Run a full diagnostic on a savePath (SAF URI or plain path).
 * Logs every check to console for debugging download failures.
 */
export const diagnoseSavePath = async(savePath: string): Promise<{
  isSafUri: boolean
  exists: boolean
  readDirOk: boolean
  readDirEntries: number
  writeTestOk: boolean
  persistedPermissions: string[]
  decodedUri: string
  error?: string
}> => {
  const TAG = '[SAF_DIAG]'
  const isSafUri = savePath.startsWith('content://')
  const decodedUri = (() => { try { return decodeURIComponent(savePath) } catch { return savePath } })()

  console.log(`${TAG} ========== SAVE PATH DIAGNOSTIC START ==========`)
  console.log(`${TAG} savePath="${savePath}"`)
  console.log(`${TAG} decodedUri="${decodedUri}"`)
  console.log(`${TAG} isSafUri=${isSafUri} length=${savePath.length}`)
  console.log(`${TAG} contains /tree/=${savePath.includes('/tree/')} contains /document/=${savePath.includes('/document/')}`)
  console.log(`${TAG} hasEncodedChars=${/%[0-9A-Fa-f]{2}/.test(savePath)}`)

  // 1. exists
  let exists = false
  try {
    exists = await FileSystem.exists(savePath)
    console.log(`${TAG} [1] exists(savePath)=${exists}`)
  } catch (e: any) {
    console.log(`${TAG} [1] exists() ERROR: ${e.message}`)
  }

  // 2. readDir
  let readDirOk = false
  let readDirEntries = 0
  try {
    const entries = await FileSystem.ls(savePath)
    readDirEntries = entries?.length ?? 0
    readDirOk = true
    console.log(`${TAG} [2] readDir OK: ${readDirEntries} entries`)
    if (readDirEntries > 0) {
      const preview = entries.slice(0, 5).map((e: any) => typeof e === 'string' ? e : e.name ?? JSON.stringify(e))
      console.log(`${TAG} [2] first ${preview.length} entries: ${JSON.stringify(preview)}`)
    }
  } catch (e: any) {
    console.log(`${TAG} [2] readDir ERROR: ${e.message}`)
  }

  // 3. write test (create a tiny temp file then delete)
  let writeTestOk = false
  const testFileName = `.saf_diag_test_${Date.now()}.tmp`
  const testPath = isSafUri ? `${savePath}/${testFileName}` : `${savePath}/${testFileName}`
  try {
    await FileSystem.writeFile(testPath, 'saf_diag_test', 'utf8')
    const written = await FileSystem.exists(testPath)
    writeTestOk = written
    console.log(`${TAG} [3] writeTest: wrote="${testPath}" existsAfterWrite=${written}`)
    if (written) {
      await FileSystem.unlink(testPath).catch(() => {})
      console.log(`${TAG} [3] writeTest: cleanup OK`)
    }
  } catch (e: any) {
    console.log(`${TAG} [3] writeTest ERROR: ${e.message}`)
  }

  // 4. persisted permissions (SAF only)
  let persistedPermissions: string[] = []
  if (isSafUri) {
    try {
      const uris = await AndroidScoped.getPersistedUriPermissions()
      persistedPermissions = uris ?? []
      console.log(`${TAG} [4] persistedPermissions: count=${persistedPermissions.length}`)
      for (const uri of persistedPermissions) {
        const match = uri === savePath || savePath.startsWith(uri) || uri.startsWith(savePath)
        console.log(`${TAG} [4]   perm uri="${uri}" matchCurrent=${match}`)
      }
      const hasExactMatch = persistedPermissions.some(u => u === savePath || savePath.startsWith(u))
      console.log(`${TAG} [4] hasPermissionForSavePath=${hasExactMatch}`)
    } catch (e: any) {
      console.log(`${TAG} [4] getPersistedUriPermissions ERROR: ${e.message}`)
    }
  }

  // 5. parent directory check for SAF
  if (isSafUri && !exists) {
    // Try decoding and checking with decoded URI
    if (decodedUri !== savePath) {
      try {
        const decodedExists = await FileSystem.exists(decodedUri)
        console.log(`${TAG} [5] decodedUri exists=${decodedExists}`)
      } catch (e: any) {
        console.log(`${TAG} [5] decodedUri exists ERROR: ${e.message}`)
      }
    }

    // Try removing trailing path segments to find working ancestor
    const parts = savePath.split('/')
    for (let i = parts.length - 1; i > 3; i--) {
      const ancestor = parts.slice(0, i).join('/')
      if (!ancestor.includes('/tree/') && !ancestor.includes('/document/')) continue
      try {
        const ancestorExists = await FileSystem.exists(ancestor)
        console.log(`${TAG} [5] ancestor[${i}]="${ancestor.substring(0, 80)}" exists=${ancestorExists}`)
        if (ancestorExists) break
      } catch {}
    }
  }

  const error = !exists
    ? 'savePath does not exist (exists()=false)'
    : !writeTestOk
      ? 'savePath exists but is not writable (writeTest failed)'
      : undefined

  console.log(`${TAG} RESULT: exists=${exists} readDir=${readDirOk} writeTest=${writeTestOk} error=${error ?? 'none'}`)
  console.log(`${TAG} ========== SAVE PATH DIAGNOSTIC END ==========`)

  return { isSafUri, exists, readDirOk, readDirEntries, writeTestOk, persistedPermissions, decodedUri, error }
}