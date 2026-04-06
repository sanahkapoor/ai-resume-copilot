// server/src/services/pdfParser.js

const pdfParse = require('pdf-parse');

class PdfParser {
  /**
   * Extracts plain text from a PDF buffer.
   * @param {Buffer} buffer - The raw PDF file buffer from multer
   * @returns {Promise<string>} - Extracted text content
   */
  async extract(buffer) {
    try {
      const data = await pdfParse(buffer);

      // data.text contains all the raw extracted text
      const rawText = data.text;

      // Basic cleanup: collapse multiple blank lines, trim whitespace
      const cleanText = rawText
        .replace(/\r\n/g, '\n')       // normalize line endings
        .replace(/\n{3,}/g, '\n\n')   // max 2 consecutive blank lines
        .trim();

      if (!cleanText || cleanText.length < 50) {
        throw new Error('PDF appears to be empty or unreadable (scanned image?)');
      }

      return cleanText;

    } catch (err) {
      // Give a clear error message instead of a cryptic one
      if (err.message.includes('Invalid PDF')) {
        throw new Error('The uploaded file is not a valid PDF.');
      }
      throw err;
    }
  }

  /**
   * Returns basic metadata about the PDF (optional, useful for debugging)
   * @param {Buffer} buffer
   * @returns {Promise<object>}
   */
  async getMetadata(buffer) {
    const data = await pdfParse(buffer);
    return {
      pages: data.numpages,
      wordCount: data.text.split(/\s+/).length,
      info: data.info, // author, title, creator etc.
    };
  }
}

module.exports = new PdfParser();