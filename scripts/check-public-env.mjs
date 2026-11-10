/** Validate before Vite can inline frontend environment values into a bundle. */
export function assertPublicEnvironment(env) {
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith("VITE_") || typeof raw !== "string" || !raw.trim()) continue;
    const value = raw.trim();
    let role;
    if (value.startsWith("eyJ")) {
      try { role = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")).role; }
      catch { /* A non-Supabase value may also start with eyJ. */ }
    }
    if (value.startsWith("sb_secret_") || role === "service_role") {
      throw new Error(`${name}: refusing to bundle a Supabase privileged key. Use a publishable key.`);
    }
    if (["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"].includes(name)
      && !value.startsWith("sb_publishable_") && role !== "anon") {
      throw new Error(`${name}: use a Supabase publishable key or legacy anon key.`);
    }
  }
}
