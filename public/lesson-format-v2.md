# QFT Markdown lesson project — format version 2

This open format packages editable Markdown slides, pictures, and self-contained interactive demonstrations. It is used by [md.qft.org](https://md.qft.org/), a browser-local, MIT-licensed application. You can generate a project with any AI or text editor and host the application independently.

## The teacher's workflow

1. Choose **Create with AI**, enter the topic and class details, and copy the instructions into your AI tool. Give the AI a chapter or source material there if it needs one. The website itself does not send material to an AI service.
2. Download the AI's complete project ZIP and use **Open file**, **Open AI lesson**, or drag and drop to open it in the workspace.
3. Edit the slide text directly. Choose **Edit demo** on a demonstration to change its starting settings or HTML. **Lesson files** opens other text files in the project.
4. Choose **Check lesson**. Copy its report back to the AI when something needs fixing. Run the demonstrations and rehearse with **Present**.
5. Download **Project ZIP** to preserve editable sources, **HTML** for an independent interactive presentation, or **Save PDF** for static handouts.
6. To revise with AI, give it the latest Project ZIP. Ask it to preserve `projectId` and file paths. Reopen the resulting ZIP and review the changes before updating the existing lesson or importing a new copy. The earlier version is retained as a recovery draft when a lesson is updated.

## Package structure

Place `qft.json` at the ZIP root when authoring a project. The importer also accepts a single enclosing project folder, as commonly produced by desktop ZIP tools, and ignores ordinary operating-system metadata. A typical project contains:

- `qft.json` — manifest and stable project identity.
- `slides.md` — current lesson source.
- `images/figure.png` — local raster pictures.
- `demos/explore.html` — self-contained demonstration source.
- `README.md` — teaching assumptions, instructions, and source/figure attribution.

The manifest's `document` selects the main Markdown file. Additional supported text files are preserved when importing and exporting a project. Paths are case-sensitive. Do not include absolute paths, backslashes, drive names, `.`/`..` path segments, or duplicate entries. References inside Markdown may use safe relative paths that stay inside the project; references resolve relative to the main Markdown file's directory.

```json
{
  "format": "qft-markdown",
  "version": 2,
  "projectId": "088a65e0-0b96-4fa8-b94b-51db5a06e5ce",
  "document": "slides.md",
  "title": "Introduction to wave packets",
  "mode": "slides",
  "slideTheme": "paper",
  "slideRatio": "16:9",
  "images": []
}
```

Generate a fresh UUID for a new lesson. Keep it unchanged when returning an AI revision of that lesson. The ID allows 1–128 ASCII letters, digits, underscores, or hyphens, beginning with a letter or digit. An ID helps the workspace find the earlier draft; it does not overwrite a draft automatically. The teacher chooses whether to update or create a copy.

`format`, `version`, `projectId`, `document`, `title`, and `images` are required for version 2. `mode` is `document` or `slides`; slide theme is `paper`, `midnight`, or `serif`; slide ratio is `16:9` or `4:3`. Use `mode: "slides"` for teaching presentations. `serif` is called **Academic** in the interface.

The [JSON schema](https://md.qft.org/lesson.schema.json) describes the manifest. Runtime validation also checks archive paths, file contents, quotas, and references; schema validation alone cannot validate a complete ZIP.

### Image mappings

For a new AI-generated project, use `images: []` and ordinary relative paths in Markdown. The importer discovers supported raster files automatically:

```markdown
![The real and imaginary parts of a localized wave packet](images/wave-packet.png)
```

The application may export entries such as `{"path":"images/wave-packet.png","reference":"qft-image:IMAGE-ID","name":"wave-packet.png"}` to reconnect its browser-local image references. Keep these mappings if you are editing an exported manifest. AI authors normally do not need to construct them.

PNG, JPEG, WebP, and GIF are supported. The bytes must match the declared image format. SVG and PDF are not imported as pictures. For scientific plots, export a sufficiently large raster image and keep its generation source in the project when useful. Browser-local attachment references work only with the complete project or image bundle, not with a `.md` file alone.

## Slides and mathematics

Use ordinary Markdown. Separate slides with a blank line, a line containing `---`, and another blank line. Separators in code and display mathematics stay literal.

```markdown
# Wave packets

One central question for the lesson.

---

## Time evolution

$$
i\hbar\,\partial_t\psi=\hat H\psi
$$

Explain each symbol and the assumptions.
```

Inline math supports `$...$` and `\(...\)`. Display math supports `$$...$$` and `\[...\]`. KaTeX handles a supported subset of TeX; it does not compile a full LaTeX document. Use standard Markdown images, lists, tables, links, and code fences. This format does not implement Marp directives, Slidev components, MDX, or raw HTML slide layouts.

## Separate interactive demo files

Reference a UTF-8 `.html` or `.htm` file from an empty `interactive` fence:

````markdown
## Predict, then test

```interactive src="demos/explore.html" title="Explore the model"
```
````

Give a demo slide only a short heading and one interactive block. Put prediction questions and explanation on the preceding slide so the demonstration has room. `src` resolves relative to the main Markdown file. Keep each demo self-contained, with all JavaScript and CSS in the HTML file. The application preserves extra `.js` and `.css` source files for reuse, but does not load them as dependencies inside a running demo. An AI may use such files while developing, then inline the needed code into the demonstration HTML before returning the project.

A minimal working demonstration:

```html
<style>
  body { margin: 20px; font: 18px system-ui, sans-serif; }
  button { font: inherit; padding: 10px 18px; }
</style>
<button id="counter" type="button">Count: 0</button>
<script>
  let count = 0;
  const button = document.getElementById('counter');
  button.addEventListener('click', () => {
    button.textContent = `Count: ${++count}`;
  });
</script>
```

Supported design:

- Native HTML controls, inline styles, inline scripts, canvas, and embedded raster data images.
- `addEventListener` for event handlers, labeled keyboard-accessible controls, and responsive sizing.
- Source-defined initial values and an explicit Reset button.
- A layout that fits roughly 1100 × 400 pixels when one demo shares a widescreen slide with a short heading.

Unavailable inside a demo:

- CDN libraries, linked JavaScript or stylesheets, module imports, network requests, workers, or remote images.
- Inline event attributes such as `onclick`, `eval`, nested frames, popup windows, and form submission.
- Access to the workspace, its documents, browser storage, or cookies.
- Automatic KaTeX rendering of Markdown math inside the HTML. Write labels directly or draw them.

The reader chooses **Run demo** to start a sandboxed frame. Editing or restarting returns to values defined in source. Runtime slider changes are temporary. The sandbox restricts browser capabilities, but it does not prove a demo's code is numerically correct or prevent expensive computations. Write bounded calculations and test the controls.

You may also put self-contained HTML directly inside an `interactive title="..."` fence. Ordinary `html` and `javascript` fences display code without running it.

## Built-in demonstrations and initial settings

Built-in demos accept an empty body for their defaults, or one JSON object specifying initial values:

````markdown
```interactive wave-packet
{"sigma":1.2,"momentum":0.5,"time":0,"view":"density"}
```
````

The editor's **Edit demo** control writes these settings for you. Unspecified values use defaults. Numeric values must follow the stated increments starting at the minimum. Unknown fields, wrong types, out-of-range values, and unsupported increments are rejected.

| Preset | Setting | Range or choices | Step | Default |
| --- | --- | --- | --- | --- |
| `wave-packet` | `sigma` | 0.6 to 2.5 | 0.05 | 1 |
| `wave-packet` | `momentum` | −2 to 2 | 0.1 | 1 |
| `wave-packet` | `time` | 0 to 6 | 0.01 | 0 |
| `wave-packet` | `view` | `density`, `amplitude` | — | `density` |
| `bloch-sphere` | `theta` | 0 to 180 degrees | 1 | 60 |
| `bloch-sphere` | `phi` | 0 to 360 degrees | 1 | 45 |
| `effective-potential` | `mass` | 0.5 to 2 | 0.05 | 1 |
| `effective-potential` | `ell` | Integer 0 to 6 | 1 | 2 |
| `interference` | `k` | 0.8 to 3 | 0.05 | 2 |
| `interference` | `delta` | 0.15 to 1 | 0.05 | 0.5 |
| `interference` | `time` | 0 to 12 | 0.01 | 0 |
| `interference` | `dispersion` | `quadratic`, `linear` | — | `quadratic` |

## Checks and limits

**Check lesson** uses the same Markdown, KaTeX, and demo parser as the preview. It reports syntax failures, missing images/demos, unsupported demo dependencies, and potential slide crowding without running code or accessing the network. Its report can be copied to AI. A successful static check does not verify the scientific explanation, final slide fit, or JavaScript behavior. Rehearse with **Present**, run every demo, and open the exported HTML before class.

| Item | Limit |
| --- | --- |
| Main Markdown | 400,000 characters |
| Slides | 200 |
| Interactive demo blocks | 20 |
| Each custom demo | 100,000 characters |
| ZIP size and expanded supported contents | 30 MiB |
| Archive entries | 150 |
| Each image | 8 MiB |
| All images | 24 MiB, 50 images |
| Each preserved text file | 2 MiB |
| Additional project text combined | 6 MiB |

Supported text source files have extensions `.md`, `.markdown`, `.txt`, `.json`, `.html`, `.htm`, `.js`, or `.css`, or the extensionless names `README`, `LICENSE`, `LICENCE`, or `NOTICE`. Paths can contain up to 240 characters. Filenames, source text, main-document path, pictures, and project identity are retained across version-2 imports/exports. Preserve the full project when asking AI for a revision. The manifest and browser-local image references can be regenerated when exporting; byte-for-byte ZIP identity is not promised.

Version-1 QFT bundles remain readable, as do simple ZIPs with one Markdown file and raster images. Importing a plain `.md` file cannot read sibling files. Use a complete Project ZIP when the lesson has pictures or linked demos.

## Editable sources, classroom exports, and licenses

**Project ZIP** is the editable source. **HTML** is a standalone interactive classroom copy with the required renderer assets and supported demo source included. **Save PDF** creates static pages: it can include a recently captured demo canvas or an initial illustration/placeholder, and cannot run JavaScript. The website itself is not guaranteed to reopen offline; keep the exported HTML for classroom use without a network connection.

The application, starter code, and this format documentation are distributed under the project's MIT license. Preserve applicable copyright and permission notices when reusing the code. The application does not apply its license to a teacher's text, textbook extracts, or third-party pictures. Keep source attribution and permissions with the lesson.
