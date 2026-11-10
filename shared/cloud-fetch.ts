/** Bound Auth and Data API requests, while retaining the caller's cancellation. */
export async function boundedCloudFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
  const cancel = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) cancel();
  else callerSignal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  catch (error) {
    if (timedOut) throw new Error("Supabaseへの通信がタイムアウトしました。通信復旧後に操作結果を再照会します。");
    throw error;
  } finally { clearTimeout(timer); callerSignal?.removeEventListener("abort", cancel); }
}
