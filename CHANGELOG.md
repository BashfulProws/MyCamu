# Changelog

How to update an existing install: see [UPDATING.md](UPDATING.md).

## 0.2.0

**New**
- `read_file` tool: Claude (or any connected AI) can now read and summarize your course files. The Worker downloads the
  file, pulls out the text and sends only the text. Works for PDF, PowerPoint (`.pptx` and old `.ppt`, with speaker notes),
  Word (`.docx` and old `.doc`, including tables), Excel (`.xlsx` and old `.xls`), OpenDocument (`.odt`, `.odp`, `.ods`),
  RTF, HTML, plain text and ZIP files containing those. Long files come back in parts.
- The Worker home page now shows its version, for example `MyCamu 0.2.0 is running`.
- Guides: beginner guide for Windows, Mac and Linux; install guide covering Claude, Claude Code, ChatGPT, Gemini CLI,
  Cursor, VS Code and Codex CLI; this updating guide.

**Fixed**
- The placeholder address in `wrangler.jsonc` used capital letters, which Cloudflare rejects, so the very first `npx wrangler deploy`
  failed for new installs. It is now lowercase.

**Changed**
- `get_file` now tells the AI to use `read_file` for reading, and the storage hint no longer mentions a specific product.

**Good to know**
- Scanned PDFs, images, videos and password-protected files cannot be read.
- On the free Cloudflare plan, PDFs and big files may hit the per-request processing limit. The paid Workers plan removes it.

## 0.1.0

First public version: `get_timetable`, `get_attendance` (with how many classes you can still miss), `list_subjects`,
`list_course_files` and `get_file` (temporary download link), connected over OAuth with a passphrase.
