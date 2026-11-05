import { extractText } from 'unpdf';
import mammoth from 'mammoth';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Pulls plain text out of an uploaded PDF, DOCX or TXT resume.
 * Scanned PDFs have no text layer, so they come back empty and the candidate is routed to
 * "Parsing failed" (manual review) instead of being auto-rejected.
 */
export async function resumeTextFrom(buffer, filename = '') {
  if (buffer.length > MAX_BYTES) {
    const e = new Error('That file is larger than 5 MB. Upload a smaller copy.');
    e.statusCode = 413;
    throw e;
  }
  const name = filename.toLowerCase();
  try {
    if (name.endsWith('.pdf')) {
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      return String(text ?? '').trim();
    }
    if (name.endsWith('.docx')) {
      const { value } = await mammoth.extractRawText({ buffer });
      return value.trim();
    }
    if (name.endsWith('.txt') || name === '') {
      return buffer.toString('utf8').trim();
    }
  } catch {
    return '';
  }
  const e = new Error('Upload a PDF, Word (.docx) or text (.txt) resume.');
  e.statusCode = 415;
  throw e;
}
