/**
 * 補充標準 lib 沒有涵蓋的執行環境型別。
 *
 * 這裡的宣告全部對應「實際存在但 TS 標準定義沒收錄」的 API，
 * 不是為了消警告而捏造的型別——每一條都標了來源。
 */

/**
 * V8 專屬的 stack trace API，非 ECMAScript 標準，
 * 所以 TS 的 ErrorConstructor 沒有收。Chrome/Node 都有。
 * 用於 src/lib/errors.js 的 BabelBridgeError。
 */
interface ErrorConstructor {
  captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
}

/**
 * Chrome tabCapture 專用的 legacy constraint 語法。
 * 標準 MediaTrackConstraints 沒有 mandatory，但 tabCapture 取得的
 * MediaStream 必須靠這個舊語法帶 chromeMediaSource/chromeMediaSourceId，
 * 換成標準語法會取不到串流。見 CLAUDE.md 紅線與 docs/DEVELOPMENT.md。
 */
interface MediaTrackConstraints {
  mandatory?: {
    chromeMediaSource?: string;
    chromeMediaSourceId?: string;
    [key: string]: unknown;
  };
}

/**
 * Service Worker 的全域建構子。專案同一份 lib code 會同時跑在
 * window（popup/content）與 ServiceWorkerGlobalScope 兩種環境，
 * src/lib/crypto-utils.js 靠 instanceof 分辨，所以需要值層宣告而非只有型別。
 */
declare var WorkerGlobalScope: {
  prototype: WorkerGlobalScope;
  new (): WorkerGlobalScope;
};
