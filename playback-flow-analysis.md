# LX Music Mobile — 在线播放流程完整分析报告

> 本报告面向学习者，全面梳理 `lx-music-mobile` 项目中**在线音乐播放**的完整链路，从应用启动到声音输出，涵盖每个关键模块的职责、数据流向和设计意图。

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与核心依赖](#2-技术栈与核心依赖)
3. [整体架构图](#3-整体架构图)
4. [播放流程全景（10 步）](#4-播放流程全景10-步)
5. [模块详解](#5-模块详解)
   - 5.1 [应用初始化](#51-应用初始化)
   - 5.2 [API 音源系统](#52-api-音源系统)
   - 5.3 [音乐 URL 解析](#53-音乐-url-解析)
   - 5.4 [播放器核心](#54-播放器核心)
   - 5.5 [轨道管理与队列](#55-轨道管理与队列)
   - 5.6 [播放事件与远程控制](#56-播放事件与远程控制)
6. [错误处理与重试策略](#6-错误处理与重试策略)
7. [预加载机制](#7-预加载机制)
8. [播放进度与持久化](#8-播放进度与持久化)
9. [下载即播放模式](#9-下载即播放模式)
10. [歌词系统](#10-歌词系统)
11. [播放模式（切歌逻辑）](#11-播放模式切歌逻辑)
12. [关键数据结构速查](#12-关键数据结构速查)
13. [建议学习路线](#13-建议学习路线)

---

## 1. 项目概览

`lx-music-mobile` 是 [洛雪音乐助手](https://github.com/lyswhut/lx-music-desktop) 的移动端版本，基于 **React Native** 构建。它支持多个在线音源（酷我、酷狗、网易云、QQ音乐、咪咕、百度等），并允许用户自定义 API 音源。

在线播放的核心链路可以概括为：

```
用户点击播放 → 解析音乐 URL → 获取封面/歌词 → 提交给原生播放器 → 音频输出
```

---

## 2. 技术栈与核心依赖

| 层级 | 技术 | 说明 |
|------|------|------|
| UI 框架 | React Native 0.73.11 | 跨平台移动端框架 |
| 音频播放 | `react-native-track-player` (自定义 fork) | 原生音频播放引擎，支持后台播放、远程控制 |
| 状态管理 | Zustand 风格自定义 store | `src/store/player/` 管理播放器状态 |
| 事件总线 | 自定义 EventEmitter | `global.app_event` / `global.state_event` |
| 网络请求 | 自定义 `request` 封装 | `src/utils/request.js` |
| 持久化 | AsyncStorage | 缓存播放信息、音乐 URL、进度等 |
| 音源 SDK | `src/utils/musicSdk/` | 各平台音乐 API 的统一封装 |

---

## 3. 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户交互层 (UI)                          │
│  src/views/  →  点击歌曲 → 调用 core/player/player.ts          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     播放控制层 (Core)                            │
│  src/core/player/player.ts                                      │
│  ├─ handlePlay() → debouncePlay()                               │
│  ├─ playNext() / playPrev()                                     │
│  └─ playList() / playLater()                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────────┐ ┌───────────┐ ┌────────────────────┐
│  URL 解析层       │ │  歌词层    │ │  封面获取层          │
│  src/core/music/  │ │ core/     │ │  utils/tools.ts    │
│  ├─ online.ts     │ │ lyric     │ │  → getPicPath()    │
│  ├─ utils.ts      │ └───────────┘ └────────────────────┘
│  └─ index.ts      │
└────────┬─────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API 音源层 (Music SDK)                        │
│  src/utils/musicSdk/                                            │
│  ├─ api-source.js        # 音源路由                              │
│  ├─ kw/ kg/ wy/ tx/ mg/ bd/  # 内置音源实现                      │
│  └─ user API bridge      # 自定义音源 (native module)            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   原生播放器层 (TrackPlayer)                      │
│  src/plugins/player/                                            │
│  ├─ playList.ts     # 轨道构建与队列管理                          │
│  ├─ service.ts      # 播放事件 & 远程控制                         │
│  └─ utils.ts        # 播放器工具函数                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   状态管理 & 事件广播                             │
│  src/store/player/    # playerState (Zustand)                   │
│  src/event/           # appEvent / stateEvent                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 播放流程全景（10 步）

下面是一首歌从「用户点击」到「声音输出」的完整链路，每一步标注了对应的源文件：

| 步骤 | 动作 | 关键文件 | 说明 |
|------|------|----------|------|
| **1** | 用户点击歌曲 | UI 层 | 触发 `handlePlay(musicInfo)` |
| **2** | 防抖处理 | `src/core/player/player.ts` | 200ms debounce，防止快速重复点击 |
| **3** | 获取音乐 URL | `src/core/music/index.ts` → `getMusicUrl()` | 先查缓存 → 在线获取 → 失败则跨源搜索 |
| **4** | 获取歌词 | `src/core/lyric/` | 与 URL 获取并行执行 |
| **5** | 获取封面 | `src/utils/tools.ts` → `getPicPath()` | 与 URL 获取并行执行 |
| **6** | 设置资源 | `src/core/player/player.ts` → `setResource()` | 将 URL/封面/歌词组装为播放资源 |
| **7** | 构建轨道 | `src/plugins/player/playList.ts` → `buildTracks()` | 创建「真实轨道 + 占位轨道」两条 track |
| **8** | 提交到 TrackPlayer | `handlePlayMusic()` | 添加到队列 → 跳转到新轨道 → seek 到进度 → 播放 |
| **9** | 播放事件广播 | `src/plugins/player/service.ts` | PlaybackState 变化 → 发射 `app_event` 事件 |
| **10** | UI 状态同步 | `src/store/player/` | 事件驱动更新 UI（播放/暂停/进度等） |

### 流程图（简化版）

```
handlePlay(musicInfo)
    │
    ├─[并行]─→ getMusicUrl(musicInfo)     → 拿到播放链接
    ├─[并行]─→ getPicPath(musicInfo)      → 拿到封面路径
    └─[并行]─→ getLyricInfo(musicInfo)    → 拿到歌词数据
    │
    ▼
setResource(url, pic, lyric)
    │
    ▼
debounce(800ms) → playMusic()
    │
    ▼
handlePlayMusic(musicInfo)
    ├─ buildTracks(url)           → [真实轨道, 占位轨道]
    ├─ TrackPlayer.add(tracks)
    ├─ TrackPlayer.skip(trackId)
    ├─ TrackPlayer.seekTo(time)   → 恢复上次进度
    └─ TrackPlayer.play()
    │
    ▼
🔊 音频输出 → service.ts 监听状态 → 广播事件 → UI 更新
```

---

## 5. 模块详解

### 5.1 应用初始化

**入口**: `src/app.ts`

应用启动时会调用 `initPlayer(setting)` 来初始化整个播放系统。该函数位于 `src/core/init/index.ts`，内部按顺序执行 **8 个子初始化**：

```
1. initPlayer          → 初始化 TrackPlayer 原生播放器
2. initLyric           → 初始化歌词模块
3. initPlayInfo        → 从 AsyncStorage 恢复上次播放状态（歌曲、进度、列表）
4. initPlayStatus      → 恢复播放/暂停状态
5. initPlayerEvent     → 注册播放器事件监听（错误、状态变化等）
6. initWatchList       → 监听播放列表变化
7. initPlayProgress    → 启动进度轮询（1秒一次）
8. initPreloadNextMusic → 注册预加载逻辑
```

> 📁 关键文件: `src/core/init/player/index.ts`，其中每个子模块在 `src/core/init/player/` 目录下各有独立文件。

**同时**，`registerPlaybackService()` 注册了 `TrackPlayer.registerPlaybackService()`，用于接收系统级远程控制事件（锁屏播放控制、蓝牙耳机按钮等）。

### 5.2 API 音源系统

**设计思想**: 将不同音乐平台的 API 抽象为统一接口，通过 `apiSource` 配置切换。

**核心文件**:
- `src/core/apiSource.ts` — 音源切换逻辑
- `src/utils/musicSdk/api-source.js` — 音源路由
- `src/utils/musicSdk/` — 各平台实现（kw/kg/wy/tx/mg/bd）

**两种音源模式**:

```
┌─────────────────────────────────┐
│         apiSource 设置           │
├────────────────┬────────────────┤
│   内置音源      │   自定义音源    │
│                │                │
│ apiList[       │ global.lx.     │
│  `${apiSource} │ apis[source]   │
│  _api_${source}`│               │
│ ]              │ 由 native      │
│                │ module 桥接    │
│ kw/wy/tx/...   │ 加载自定义JS   │
└────────────────┴────────────────┘
```

- **内置音源**: 通过 `apis(source)` 函数从 `apiList` 中查找对应实现
- **自定义音源**: 通过 `src/core/init/userApi/index.ts` 中的 native module 桥接加载，使用 `sendUserApiRequest` 通信，有 20 秒超时限制

### 5.3 音乐 URL 解析

这是在线播放最核心的环节之一——拿到一首歌可以播放的真实 URL。

**入口**: `src/core/music/index.ts` → `getMusicUrl()`

**路由逻辑**:
```
getMusicUrl(musicInfo, quality, isDownload?)
    │
    ├─ 下载项? → getDownloadMusicUrl()
    ├─ 本地?   → getLocalMusicUrl()
    └─ 在线?   → getOnlineMusicUrl()  ← 我们关注的路径
```

**在线获取详细流程** (`src/core/music/online.ts`):

```
getOnlineMusicUrl(musicInfo, quality, isToggle)
    │
    ├─ 1. 检查缓存
    │     └─ getStoreMusicUrl(id, quality)
    │        缓存 key: @music_url__${id}_${quality}
    │        命中 → 直接返回
    │
    ├─ 2. 在线获取
    │     └─ handleGetOnlineMusicUrl()
    │        └─ musicSdk[source].getMusicUrl(songInfo, quality).promise
    │
    └─ 3. 失败时跨源搜索（toggle source）
          ├─ getOtherSource(musicInfo)
          ├─ findMusic() → searchMusic() 遍历所有其他音源
          └─ getOnlineOtherSourceMusicUrl() 逐个重试
```

**音质选择** (`src/core/music/utils.ts` → `getPlayQuality()`):

```
用户设置的音质 (player.playQuality)
    │
    ▼ 按优先级尝试
TRY_QUALITYS_LIST = ['flac24bit', 'flac', '320k']
    │
    ▼ 如果都不支持
默认回退到 '128k'
```

### 5.4 播放器核心

**核心文件**: `src/core/player/player.ts`

这是整个播放系统的**中枢调度器**，所有播放动作都从这里发起。

**`handlePlay(musicInfo)` 完整流程**:

```typescript
handlePlay(musicInfo)
    │
    ▼
debouncePlay(musicInfo)  // 200ms 防抖
    │
    ├─ setMusicUrl(musicInfo)        // 获取并设置播放 URL
    ├─ getPicPath(musicInfo)         // 获取封面（并行）
    └─ getLyricInfo(musicInfo)       // 获取歌词（并行）
    │
    ▼ 三者都完成后
setResource({ url, pic, lyric })
    │
    ▼
debounce(800ms) → playMusic()  // 再次防抖，避免频繁切换
    │
    ▼
handlePlayMusic(musicInfo, url)
    └─ 交给 plugins/player/playList.ts 处理
```

**`setMusicUrl()` 的 URL 获取逻辑**:

```typescript
setMusicUrl(musicInfo, isRefresh = false)
    │
    ├─ 1. 尝试获取 toggleMusicInfo 的源 URL（如果有备用源）
    │
    ├─ 2. 回退到原始源
    │     └─ getMusicPlayUrl(musicInfo, { allowToggleSource: true })
    │        有重试逻辑（随机 2-6 秒延迟）
    │        有 100 秒加载超时
    │
    └─ 3. 成功 → 设置到 playerState
          失败 → 触发错误事件
```

### 5.5 轨道管理与队列

**核心文件**: `src/plugins/player/playList.ts`

TrackPlayer 是原生音频播放器，通过「轨道队列」管理播放。本项目设计了一套**独特的双轨道机制**：

**每首歌创建 2 条 Track**:

```javascript
// 真实轨道 — 包含实际播放 URL
{
  id: `${musicId}__//${random}__//${url}`,
  url: actualMusicUrl,
  title: songName,
  artist: artist,
  artwork: coverPath,
  // ... 元数据
}

// 占位轨道 — 静默音频，用于检测播放结束
{
  id: `${musicId}__//${random}__//default`,
  url: 'Silence02s.mp3',  // 2秒静音文件
  // ... 同样的元数据
}
```

**为什么需要占位轨道？**

这是本项目的一个巧妙设计。由于 TrackPlayer 在某些情况下无法正确触发「播放完成」事件，通过在真实轨道后紧跟一个 2 秒静音轨道，当播放器切换到静音轨道时，通过检测 `//default` 后缀就能可靠地判断「当前歌曲播放完毕」，从而触发下一首。

**队列管理规则**:
- 每次播放后，队列只保留最多 **2 条**轨道（当前 + 下一个）
- `isEmpty()` 通过检查当前轨道 ID 是否匹配 `//default$` 模式来判断是否播完

### 5.6 播放事件与远程控制

**核心文件**: `src/plugins/player/service.ts`

该文件是原生播放器与 JS 层之间的**桥梁**。

**播放状态事件映射**:

```
TrackPlayer PlaybackState
    │
    ├─ Playing    → global.app_event.play()
    ├─ Paused     → global.app_event.pause()
    ├─ Buffering  → global.app_event.waiting()
    ├─ Loading    → global.app_event.loadstart()
    └─ Error      → global.app_event.error()
                   → global.app_event.playerError()
```

**轨道变化事件**:

```
PlaybackTrackChanged
    │
    ├─ 队列为空 (isEmpty() == true)
    │   ├─ 暂停播放
    │   ├─ global.app_event.playerEnded()
    │   └─ global.app_event.playerEmptied()
    │
    └─ 队列不为空
        └─ 正常切换到下一首
```

**远程控制事件**:

```
RemotePlay     → TrackPlayer.play()
RemotePause    → TrackPlayer.pause()
RemoteNext     → 播放下一首
RemotePrevious → 播放上一首
RemoteStop     → 停止播放
RemoteSeekTo   → 跳转到指定时间
```

> 这些远程控制让用户可以通过锁屏界面、蓝牙耳机、通知栏控制播放。

---

## 6. 错误处理与重试策略

**核心文件**: `src/core/init/player/playerEvent.ts`

项目实现了一套**多层容错机制**，确保播放尽可能不中断：

### 6.1 播放错误重试

```
播放错误 (playerError)
    │
    ├─ 重试次数 < 2
    │   └─ 刷新 URL: setMusicUrl(musicInfo, true)
    │      （重新请求一个新的播放链接）
    │
    └─ 重试次数 ≥ 2
        └─ 停止 → 自动播放下一首
```

### 6.2 加载超时保护

```
25 秒加载超时检测
    │
    ├─ 同一首歌仍在加载中
    │   ├─ 未刷新过 → 刷新 URL 重试
    │   └─ 已刷新过 → 播放下一首
    │
    └─ 已切换到其他歌 → 无需处理
```

### 6.3 错误后延迟切歌

```
播放错误/队列清空
    │
    └─ 延迟 5 秒 → 自动播放下一首
       （避免快速连续失败导致的「死亡循环」）
```

---

## 7. 预加载机制

**核心文件**: `src/core/init/player/preloadNextMusic.ts`

为了实现**无缝切歌**，项目在当前歌曲播放到尾声时预先加载下一首：

```
进度 < 10 秒剩余
    │
    ▼
getNextPlayMusicInfo()        // 计算下一首歌
    │
    ▼
getMusicUrl(nextMusicInfo)    // 预获取 URL
    │
    ▼
缓存验证
├─ isCached(url)              // 检查是否已缓存
└─ checkUrl(url)              // HEAD 请求验证 URL 可用性
```

这样当用户切歌或自动播放下一首时，URL 已经在缓存中，可以立即开始播放。

---

## 8. 播放进度与持久化

**核心文件**: `src/core/init/player/playProgress.ts`

```
┌────────────────────────────────────────┐
│          进度轮询 (1秒间隔)             │
│                                        │
│  TrackPlayer.getPosition()             │
│       │                                │
│       ▼                                │
│  更新 playerState.currentTime          │
│       │                                │
│       ▼                                │
│  保存到 AsyncStorage (每 2 秒节流)      │
│  条件: player.isSavePlayTime = true    │
│  Key: @playInfo                        │
│                                        │
│  ┌─ 屏幕关闭检测 ─┐                    │
│  │ 屏幕关闭 → 暂停轮询（省电）          │
│  │ 屏幕打开 → 恢复轮询                  │
│  └─────────────────┘                   │
└────────────────────────────────────────┘
```

---

## 9. 下载即播放模式

当用户开启了「播放时自动下载」功能后，播放流程会增加一个**本地缓存层**：

```
setMusicUrl(musicInfo)
    │
    ├─ isAutoSaveOnPlay() == true?
    │   │
    │   ├─ 1. 检查本地注册表
    │   │     └─ getLocalPath(musicInfo)
    │   │        命中 → 直接播放本地文件
    │   │
    │   ├─ 2. 获取在线 URL
    │   │     └─ getMusicUrl(musicInfo)
    │   │
    │   ├─ 3. 提交下载请求
    │   │     └─ submitPlayRequest(url, musicInfo)
    │   │        交给下载调度器 (saveScheduler)
    │   │
    │   └─ 4. 等待下载完成 → 播放本地文件
    │        下载失败 → 回退到流式播放
    │
    └─ isAutoSaveOnPlay() == false?
        └─ 直接使用在线 URL 流式播放
```

> 📁 相关文件: `src/core/download/index.ts`, `src/core/download/saveScheduler.ts`

---

## 10. 歌词系统

**初始化**: `src/core/init/player/lyric.ts` → `src/core/lyric/`

歌词获取与 URL 获取**并行执行**，不互相阻塞。

```
getLyricInfo(musicInfo)
    │
    ├─ 歌词数据结构
    │   ├─ lyric       → 主歌词文本
    │   ├─ tlyric      → 翻译歌词
    │   └─ rlyric      → 罗马音歌词
    │
    ├─ 同步播放事件
    │   ├─ play   → 歌词开始滚动
    │   ├─ pause  → 歌词暂停
    │   ├─ stop   → 歌词重置
    │   └─ error  → 歌词暂停
    │
    └─ 桌面歌词 & 蓝牙歌词支持
```

---

## 11. 播放模式（切歌逻辑）

**核心文件**: `src/core/player/player.ts` → `playNext()` / `playPrev()`

### 切歌优先级

```
playNext() 选择下一首的优先级:

1. tempPlayList        → 临时播放列表（最高优先级）
2. playedList 历史      → 已播放记录（用于回退）
3. randomNextMusicInfo → 随机模式的预计算结果
4. filteredList        → 根据播放模式过滤后的列表
```

### 五种播放模式

| 模式 | 说明 | 切歌行为 |
|------|------|----------|
| `listLoop` | 列表循环 | 播完最后一首 → 回到第一首 |
| `list` | 列表顺序 | 播完最后一首 → 停止 |
| `singleLoop` | 单曲循环 | 重复播放当前歌曲 |
| `random` | 随机播放 | 从未播放的歌曲中随机选择 |
| `none` | 不循环 | 播完停止 |

### 过滤逻辑

`filterList()` 会从候选列表中移除：
- 已经播放过的歌曲（避免随机模式重复）
- 不喜欢列表中的歌曲（dislike list）

### 上一首

`playPrev()` 从 `playedList`（播放历史栈）中弹出上一首，实现真正的「回到上一首」而不是随机选一首。

---

## 12. 关键数据结构速查

### playerState 核心字段

```typescript
{
  // 当前播放信息
  musicInfo: MusicInfo,          // 当前歌曲信息
  playMusicInfo: MusicInfo,      // 实际播放的歌曲（可能是跨源替换后的）
  isPlaying: boolean,            // 是否正在播放
  isLoading: boolean,            // 是否正在加载
  currentTime: number,           // 当前播放进度（秒）
  duration: number,              // 歌曲总时长（秒）

  // 播放列表
  playList: MusicInfo[],         // 播放列表
  playedList: MusicInfo[],       // 已播放历史栈
  tempPlayList: MusicInfo[],     // 临时播放列表

  // 播放设置
  playMode: PlayMode,            // 播放模式
  playQuality: Quality,          // 音质设置
  isSavePlayTime: boolean,       // 是否保存播放进度
}
```

### MusicInfo 核心字段

```typescript
{
  id: string,                    // 歌曲 ID
  name: string,                  // 歌曲名称
  singer: string,                // 歌手
  source: string,                // 音源 (kw/kg/wy/tx/mg/bd)
  albumId: string,               // 专辑 ID
  albumName: string,             // 专辑名称
  interval: string,              // 时长字符串
  img: string,                   // 封面图片 URL
}
```

### TrackPlayer Track 结构

```typescript
{
  id: string,          // 格式: "${musicId}__//${random}__//${url或default}"
  url: string,         // 播放地址（真实URL或Silence02s.mp3）
  title: string,       // 歌曲名称
  artist: string,      // 歌手
  artwork: string,     // 封面图片路径
  duration: number,    // 时长（秒）
}
```

---

## 13. 建议学习路线

按照**从外到内、从主干到分支**的顺序阅读源码：

### 第一阶段：理解主干流程（必读）

| 顺序 | 文件 | 学习重点 |
|------|------|----------|
| 1 | `src/app.ts` | 应用入口，了解初始化入口 |
| 2 | `src/core/init/index.ts` | 8 个子初始化的执行顺序 |
| 3 | `src/core/init/player/index.ts` | 播放器初始化细节 |
| 4 | `src/core/player/player.ts` | **最重要** — 播放控制中枢 |
| 5 | `src/core/music/index.ts` | URL 获取入口路由 |
| 6 | `src/core/music/online.ts` | 在线 URL 获取核心逻辑 |
| 7 | `src/plugins/player/playList.ts` | 轨道构建与双轨机制 |

### 第二阶段：深入核心机制

| 顺序 | 文件 | 学习重点 |
|------|------|----------|
| 8 | `src/plugins/player/service.ts` | 播放事件桥接 |
| 9 | `src/core/music/utils.ts` | 音质选择、缓存策略 |
| 10 | `src/core/init/player/playerEvent.ts` | 错误重试机制 |
| 11 | `src/core/init/player/preloadNextMusic.ts` | 预加载逻辑 |

### 第三阶段：扩展功能

| 顺序 | 文件 | 学习重点 |
|------|------|----------|
| 12 | `src/core/init/player/playProgress.ts` | 进度持久化 |
| 13 | `src/core/init/player/lyric.ts` | 歌词初始化 |
| 14 | `src/core/apiSource.ts` | 音源切换 |
| 15 | `src/core/download/index.ts` | 下载即播放模式 |
| 16 | `src/store/player/state.ts` | 播放器状态定义 |
| 17 | `src/event/appEvent.ts` | 事件总线 |

### 学习建议

1. **先跑起来**: 在模拟器中运行项目，点击播放一首歌，感受完整流程
2. **断点调试**: 在 `handlePlay()` 和 `getMusicUrl()` 打断点，观察数据流向
3. **关注异常**: 故意断网或切换音源，观察错误重试逻辑如何工作
4. **画自己的流程图**: 阅读过程中手绘流程图，加深理解
5. **阅读 TrackPlayer 文档**: 理解原生播放器的 API 和事件模型

---

## 附录：文件路径速查表

```
src/
├── app.ts                           # 应用入口
├── core/
│   ├── init/
│   │   ├── index.ts                 # 主初始化（含 registerPlaybackService）
│   │   ├── player/
│   │   │   ├── index.ts             # 播放器 8 步初始化
│   │   │   ├── playerEvent.ts       # 错误重试 & 超时处理
│   │   │   ├── preloadNextMusic.ts  # 预加载下一首
│   │   │   ├── playProgress.ts      # 进度轮询 & 持久化
│   │   │   ├── lyric.ts             # 歌词初始化
│   │   │   ├── playInfo.ts          # 播放信息恢复
│   │   │   └── playStatus.ts        # 播放状态恢复
│   │   └── userApi/
│   │       └── index.ts             # 自定义 API 加载
│   ├── player/
│   │   ├── player.ts                # ★ 播放控制中枢
│   │   ├── playInfo.ts              # 播放信息管理
│   │   ├── playStatus.ts            # 播放状态管理
│   │   ├── progress.ts              # 进度管理
│   │   └── utils.ts                 # 工具函数
│   ├── music/
│   │   ├── index.ts                 # URL 获取路由
│   │   ├── online.ts                # ★ 在线 URL 获取
│   │   └── utils.ts                 # 音质选择、缓存
│   ├── apiSource.ts                 # 音源切换
│   ├── userApi.ts                   # 用户 API 管理
│   ├── lyric/                       # 歌词模块
│   └── download/
│       ├── index.ts                 # 下载管理
│       └── saveScheduler.ts         # 下载调度器
├── plugins/
│   └── player/
│       ├── index.ts                 # TrackPlayer 初始化
│       ├── playList.ts              # ★ 轨道构建 & 队列
│       ├── service.ts               # ★ 播放事件 & 远程控制
│       └── utils.ts                 # 播放器工具
├── store/
│   └── player/
│       ├── state.ts                 # 状态定义
│       └── action.ts                # 状态操作
├── event/
│   ├── appEvent.ts                  # 应用事件总线
│   └── stateEvent.ts                # 状态事件总线
├── utils/
│   ├── request.js                   # 网络请求封装
│   └── musicSdk/
│       ├── index.js                 # SDK 入口
│       ├── api-source.js            # 音源路由
│       └── kw/ kg/ wy/ tx/ mg/ bd/  # 各平台实现
└── config/
    ├── defaultSetting.ts            # 默认设置
    ├── constant.ts                  # 常量定义
    └── globalData.ts                # 全局数据
```

---

> 📝 本报告基于源码静态分析生成，最后更新于 2026-07-05。如有疑问，建议结合断点调试逐步验证。