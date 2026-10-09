# Default upload fixtures

These small, valid files are copied into the application's managed data directory and are selected automatically for `input[type="file"]` steps.

Selection is based on the input's `accept` value first, then on the field label/name, with `default-text.txt` as the final fallback. Existing user-selected files are never overwritten.

Included categories: PNG/JPEG/SVG images, PDF and Word documents, Excel/CSV data, JSON/XML/text, ZIP archives, and a generic binary fallback.
