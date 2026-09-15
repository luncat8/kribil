#!/usr/bin/env python

# === SETTINGS START ===
TRUNCATION_LIMIT = 0      # 0 means no truncation
CONVERT_TO_LF = True      # Convert all line endings (CRLF, CR) to Unix LF (\n)
TRIM_TRAIL_SPACES = True  # remove space and tabs in the end of lines
MIN_INFERENCE_LENGTH = 8  # Skip Magika for short inputs below this char length
CONVERT_TO_TABS = True    # Automatically convert spaces to 1 tab indentation
OUTPUT_DIR = ""           # Fallback if CLI arg not provided
OVERWRITE = False         # If False, rename on collision (append _001, _002, ...)
# === SETTINGS END ===


import contextlib as __stickytape_contextlib

@__stickytape_contextlib.contextmanager
def __stickytape_temporary_dir():
    import tempfile
    import shutil
    dir_path = tempfile.mkdtemp()
    try:
        yield dir_path
    finally:
        shutil.rmtree(dir_path)

with __stickytape_temporary_dir() as __stickytape_working_dir:
    def __stickytape_write_module(path, contents):
        import os, os.path

        def make_package(path):
            parts = path.split("/")
            partial_path = __stickytape_working_dir
            for part in parts:
                partial_path = os.path.join(partial_path, part)
                if not os.path.exists(partial_path):
                    os.mkdir(partial_path)
                    with open(os.path.join(partial_path, "__init__.py"), "wb") as f:
                        f.write(b"\n")

        make_package(os.path.dirname(path))

        full_path = os.path.join(__stickytape_working_dir, path)
        with open(full_path, "wb") as module_file:
            module_file.write(contents)

    import sys as __stickytape_sys
    __stickytape_sys.path.insert(0, __stickytape_working_dir)

    __stickytape_write_module('dev_helper/common/__init__.py', b'')
    __stickytape_write_module('dev_helper/common/clipboard.py', b'from __future__ import annotations\n\nimport platform\nimport subprocess\n\ntry:\n    import win32clipboard\nexcept ImportError:\n    win32clipboard = None  # type: ignore\n\n\ndef _on_windows() -> bool:\n    return bool(win32clipboard) and platform.system() == "Windows"\n\n\ndef copy_to_clipboard(text: str) -> None:\n    """Copy text to the OS clipboard (cross-platform, no third-party deps)."""\n    if _on_windows():\n        win32clipboard.OpenClipboard()\n        try:\n            win32clipboard.EmptyClipboard()\n            win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)\n        finally:\n            win32clipboard.CloseClipboard()\n        return\n\n    system = platform.system()\n    if system == "Darwin":\n        _run(["pbcopy"], text)\n    elif system == "Linux":\n        if _run(["xclip", "-selection", "clipboard"], text):\n            return\n        _run(["xsel", "--clipboard", "--input"], text)\n\n\ndef paste_clipboard() -> str:\n    """Read plain text from the OS clipboard (cross-platform)."""\n    if _on_windows():\n        win32clipboard.OpenClipboard()\n        try:\n            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):\n                return win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT) or ""\n        finally:\n            win32clipboard.CloseClipboard()\n        return ""\n\n    system = platform.system()\n    if system == "Darwin":\n        return _read(["pbpaste"])\n    if system == "Linux":\n        out = _read(["xclip", "-selection", "clipboard", "-o"])\n        if out is not None:\n            return out\n        return _read(["xsel", "--clipboard", "--output"]) or ""\n    return ""\n\n\ndef paste_clipboard_files() -> list[str]:\n    """Return file/folder paths copied to the clipboard (Windows CF_HDROP).\n\n    On Windows, copying files/folders in Explorer places a file-drop list on the\n    clipboard. This returns those paths. Returns an empty list on other platforms\n    or when no file-drop data is present.\n    """\n    if _on_windows():\n        win32clipboard.OpenClipboard()\n        try:\n            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_HDROP):\n                data = win32clipboard.GetClipboardData(win32clipboard.CF_HDROP)\n                return [p for p in (data or []) if p]\n        finally:\n            win32clipboard.CloseClipboard()\n    return []\n\n\ndef _run(cmd: list[str], text: str) -> bool:\n    """Run a clipboard command feeding `text` on stdin. Returns success."""\n    try:\n        subprocess.run(\n            cmd, input=text.encode("utf-8", "ignore"),\n            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,\n        )\n        return True\n    except Exception:\n        return False\n\n\ndef _read(cmd: list[str]) -> str | None:\n    """Run a clipboard command and return its stdout, or None on failure."""\n    try:\n        result = subprocess.run(\n            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True,\n        )\n        return result.stdout.decode("utf-8", "ignore")\n    except Exception:\n        return None\n')
    __stickytape_write_module('dev_helper/common/text_utils.py', b'from __future__ import annotations\n\nimport math\nimport re\nfrom functools import reduce\nfrom pathlib import Path\n\nPRESERVE_SPACE_EXTS = {\n    "py", "txt", "json", "md", "yaml", "yml", "toml",\n    "xml", "sh", "bash", "makefile", "dockerfile", "csv", "tsv",\n}\n\n\ndef normalize_indentation_to_tabs(\n    text: str,\n    ext: str,\n    preserve_space_exts: set[str] | None = None,\n) -> str:\n    if preserve_space_exts is None:\n        preserve_space_exts = PRESERVE_SPACE_EXTS\n\n    if ext in preserve_space_exts:\n        return text\n\n    lines = text.split("\\n")\n    space_counts: list[int] = []\n    tab_counts: list[int] = []\n\n    for line in lines:\n        if not line:\n            continue\n        if line.startswith("\\t"):\n            tab_counts.append(len(line) - len(line.lstrip("\\t")))\n        elif line.startswith(" "):\n            match = re.match(r"^( +)\\S", line)\n            if match:\n                space_counts.append(len(match.group(1)))\n\n    if not space_counts:\n        return text\n\n    if tab_counts and space_counts:\n        avg_s = sum(space_counts) / len(space_counts)\n        avg_t = sum(tab_counts) / len(tab_counts)\n        space_unit = avg_s / avg_t if avg_t != 0 else 4\n    else:\n        detected_gcd = reduce(math.gcd, space_counts)\n        space_unit = (\n            detected_gcd\n            if detected_gcd in (2, 4, 8)\n            else (space_counts[0] if len(space_counts) == 1 else 4)\n        )\n\n    processed_lines: list[str] = []\n    for line in lines:\n        if not line or line.startswith("\\t"):\n            processed_lines.append(line)\n            continue\n        match = re.match(r"^( +)(.*)$", line)\n        if match:\n            spaces, content = match.groups()\n            tab_depth = max(1, round(len(spaces) / space_unit))\n            processed_lines.append("\\t" * tab_depth + content)\n        else:\n            processed_lines.append(line)\n\n    return "\\n".join(processed_lines)\n\n\ndef normalize_line_endings(text: str) -> str:\n    """Convert CRLF and CR line endings to Unix LF."""\n    return text.replace("\\r\\n", "\\n").replace("\\r", "\\n")\n\n\ndef trim_trailing_whitespace(text: str) -> str:\n    """Remove trailing spaces and tabs from each line."""\n    return "\\n".join(line.rstrip() for line in text.split("\\n"))\n\n\ndef trim_trailing_whitespace_file(file_path: Path) -> bool:\n    """Remove trailing spaces and tabs from each line in a file. Returns True if modified."""\n    try:\n        with open(file_path, "r", encoding="utf-8") as f:\n            original = f.read()\n\n        text = trim_trailing_whitespace(original)\n\n        if text != original:\n            with open(file_path, "w", encoding="utf-8") as f:\n                f.write(text)\n            return True\n        return False\n    except Exception as e:\n        print(f"[-] Error trimming {file_path}: {e}")\n        return False\n')
    __stickytape_write_module('path_args/__init__.py', b'"""\npath_args \xe2\x80\x94 shared path/argument resolver for small Python command modules.\n\nRe-exports everything from ``command_paths`` so consumers can do::\n\n    from path_args import resolve_paths, choose_output_file\n\nThe full public API is documented in ``command_paths.py``.\n"""\n\nfrom path_args.command_paths import *  # noqa: F401,F403\n')
    __stickytape_write_module('path_args/command_paths.py', b'"""\nShared path/argument resolver for small Python command modules.\n\nResolution order:\n    1. Command line arguments: source/destination/path/etc. configured by caller.\n    2. Standard input (sys.stdin) \xe2\x80\x94 piped/redirected text.\n    3. OS clipboard file references: Explorer/Finder/file-manager copied files/dirs.\n    4. Hardcoded script constant passed by caller, only if it exists.\n    5. Current working directory.\n\nThe resolver intentionally does not know whether a command is a reader or writer.\nThe caller only tells it which argument names to inspect and how selected paths\nshould be prepared (no directory creation / create as directories / create parents\n/ auto).\n"""\n\nfrom __future__ import annotations\n\nimport argparse\nimport os\nimport platform\nimport re\nimport subprocess\nimport sys\nimport urllib.parse\nfrom dataclasses import dataclass\nfrom pathlib import Path\nfrom typing import Iterable, Literal, Sequence\n\ntry:  # Optional dependency; only useful on Windows.\n    if platform.system() == "Windows":\n        import win32clipboard  # type: ignore\n    else:\n        win32clipboard = None  # type: ignore\nexcept ImportError:  # pragma: no cover - depends on host OS/packages\n    win32clipboard = None  # type: ignore\n\nCreateMode = Literal["none", "dirs", "parents", "auto"]\n\nDEFAULT_ARG_NAMES: tuple[str, ...] = (\n    "source",\n    "sources",\n    "src",\n    "input",\n    "inputs",\n    "destination",\n    "destinations",\n    "dest",\n    "dst",\n    "output",\n    "outputs",\n    "out",\n    "path",\n    "paths",\n)\n\n\n@dataclass(frozen=True)\nclass ResolvedPaths:\n    """Result returned by resolve_paths()."""\n\n    paths: tuple[Path, ...]\n    origin: Literal["args", "stdin", "clipboard", "constant", "cwd"]\n\n    @property\n    def first(self) -> Path:\n        return self.paths[0]\n\n    def __iter__(self):\n        return iter(self.paths)\n\n    def __len__(self) -> int:\n        return len(self.paths)\n\n\n@dataclass(frozen=True)\nclass ResolvedText:\n    """\n    Result returned by resolve_input_text().\n\n    This is for commands that need *text content* (e.g. to write to a file,\n    or to process directly), not file paths to read from.\n    """\n\n    text: str\n    origin: Literal["args", "stdin", "clipboard", "constant"]\n\n\ndef add_common_path_arguments(\n    parser: argparse.ArgumentParser,\n    *,\n    positional: bool = True,\n    source: bool = True,\n    destination: bool = True,\n    positional_name: str = "paths",\n) -> argparse.ArgumentParser:\n    """\n    Add common path arguments to a command parser.\n\n    Use all of these for generic one-location commands, or disable source/dest\n    for commands that already have specific arguments.\n\n    Important: overwrite is intentionally NOT added here, because the requested\n    policy is a hardcoded per-script constant, usually OVERWRITE_EXISTING = False.\n    """\n\n    if positional:\n        parser.add_argument(\n            positional_name,\n            nargs="*",\n            help="Path(s). Meaning is command-specific; resolver treats them generically.",\n        )\n    if source:\n        parser.add_argument("-s", "--source", action="append", help="Source path. Can be repeated.")\n    if destination:\n        parser.add_argument(\n            "-d", "--destination", action="append", help="Destination path. Can be repeated."\n        )\n    return parser\n\n\n# ---------------------------------------------------------------------------\n#  Input text resolution  (args -> stdin -> clipboard -> constant)\n# ---------------------------------------------------------------------------\n\ndef _read_stdin_if_available() -> str | None:\n    """\n    Read all of sys.stdin if data is being piped/redirected.\n\n    Returns None when stdin is connected to a terminal (no data), so we can\n    fall through to clipboard / constant. Returns None for empty input too.\n    """\n    if sys.stdin.isatty():\n        return None\n    try:\n        data = sys.stdin.read()\n    except OSError:\n        return None\n    if not data.strip():\n        return None\n    return data\n\n\ndef resolve_input_text(\n    args: argparse.Namespace | object | None = None,\n    *,\n    arg_names: Sequence[str] = ("text", "content", "data"),\n    use_stdin: bool = True,\n    use_clipboard: bool = True,\n    constant: str | None = None,\n) -> ResolvedText:\n    """\n    Resolve *text content* using the shared priority chain:\n\n        1. CLI args  (e.g. --text, --content)\n        2. sys.stdin  (piped/redirected input)\n        3. OS clipboard text\n        4. Hardcoded constant\n\n    This is separate from resolve_paths(). Use this when your command needs\n    the actual text content to process (or to write), not a file-path to read.\n\n    Returns ResolvedText(text=..., origin=...).  If nothing is found, returns\n    an empty string with origin="constant" (since the constant default is "").\n    """\n\n    # 1. CLI args\n    cli_values = _collect_arg_values(args, arg_names)\n    if cli_values:\n        return ResolvedText(text="\\n".join(str(v) for v in cli_values), origin="args")\n\n    # 2. sys.stdin\n    if use_stdin:\n        stdin_text = _read_stdin_if_available()\n        if stdin_text is not None:\n            return ResolvedText(text=stdin_text, origin="stdin")\n\n    # 3. clipboard text\n    if use_clipboard:\n        clip_text = _clipboard_text()\n        if clip_text:\n            return ResolvedText(text=clip_text, origin="clipboard")\n\n    # 4. hardcoded constant\n    if constant:\n        return ResolvedText(text=constant, origin="constant")\n\n    return ResolvedText(text="", origin="constant")\n\n\n# ---------------------------------------------------------------------------\n#  Clipboard helpers\n# ---------------------------------------------------------------------------\n\ndef _clipboard_text() -> str:\n    """Read plain text from the OS clipboard (cross-platform fallback)."""\n    sys_platform = platform.system()\n\n    if sys_platform == "Windows" and win32clipboard:\n        try:\n            win32clipboard.OpenClipboard()\n            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):\n                text = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)\n                win32clipboard.CloseClipboard()\n                return text or ""\n            win32clipboard.CloseClipboard()\n        except Exception:\n            try:\n                win32clipboard.CloseClipboard()\n            except Exception:\n                pass\n\n    elif sys_platform == "Linux":\n        for tool, args_list in (\n            ("xclip", ["-selection", "clipboard", "-o"]),\n            ("xsel", ["-b", "-o"]),\n        ):\n            try:\n                proc = subprocess.Popen(\n                    [tool, *args_list],\n                    stdout=subprocess.PIPE,\n                    stderr=subprocess.PIPE,\n                )\n                stdout, _ = proc.communicate(timeout=2)\n                if proc.returncode == 0 and stdout:\n                    return stdout.decode("utf-8", errors="replace")\n            except Exception:\n                continue\n\n    elif sys_platform == "Darwin":\n        try:\n            proc = subprocess.Popen(\n                ["pbpaste"],\n                stdout=subprocess.PIPE,\n                stderr=subprocess.PIPE,\n            )\n            stdout, _ = proc.communicate(timeout=2)\n            if proc.returncode == 0 and stdout:\n                return stdout.decode("utf-8", errors="replace")\n        except Exception:\n            pass\n\n    return ""\n\n\ndef paths_from_clipboard() -> list[str]:\n    """\n    Extract existing filesystem paths from the OS clipboard.\n\n    Supports:\n      - Windows native copied file selection: CF_HDROP.\n      - Windows text fallback: Copy as Path / newline-separated paths.\n      - Linux file-manager copied files: text/uri-list via xclip.\n      - Linux text fallback: xclip/xsel clipboard text.\n      - macOS text fallback: pbpaste.\n\n    Returns only paths that currently exist on this machine.\n    """\n\n    paths: list[str] = []\n    sys_platform = platform.system()\n\n    # --- WINDOWS ---\n    if sys_platform == "Windows" and win32clipboard:\n        try:\n            win32clipboard.OpenClipboard()\n\n            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_HDROP):\n                files = win32clipboard.GetClipboardData(win32clipboard.CF_HDROP)\n                paths = list(files)\n\n            elif win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):\n                text = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)\n                paths = _lines_to_path_strings(text)\n\n        except Exception as exc:  # pragma: no cover - OS-specific\n            print(f"[Clipboard Error] Windows subsystem failure: {exc}", file=sys.stderr)\n        finally:\n            try:\n                win32clipboard.CloseClipboard()\n            except Exception:\n                pass\n\n    # --- LINUX ---\n    elif sys_platform == "Linux":\n        # Native file-manager copied files usually expose text/uri-list.\n        try:\n            proc = subprocess.Popen(\n                ["xclip", "-selection", "clipboard", "-t", "text/uri-list", "-o"],\n                stdout=subprocess.PIPE,\n                stderr=subprocess.PIPE,\n            )\n            stdout, _ = proc.communicate(timeout=2)\n            if proc.returncode == 0 and stdout:\n                for line in stdout.decode("utf-8", errors="ignore").splitlines():\n                    line = line.strip()\n                    if not line or line.startswith("#"):\n                        continue\n                    if line.startswith("file://"):\n                        paths.append(_file_uri_to_path(line))\n        except Exception:\n            pass\n\n        # Text fallback: copied path text, quoted paths, newline-separated paths.\n        if not paths:\n            for tool, args_list in (\n                ("xclip", ["-selection", "clipboard", "-o"]),\n                ("xsel", ["-b", "-o"]),\n            ):\n                try:\n                    proc = subprocess.Popen(\n                        [tool, *args_list],\n                        stdout=subprocess.PIPE,\n                        stderr=subprocess.PIPE,\n                    )\n                    stdout, _ = proc.communicate(timeout=2)\n                    if proc.returncode == 0 and stdout:\n                        text = stdout.decode("utf-8", errors="ignore")\n                        paths = _lines_to_path_strings(text)\n                        break\n                except Exception:\n                    continue\n\n    # --- MACOS ---\n    elif sys_platform == "Darwin":\n        try:\n            proc = subprocess.Popen(\n                ["pbpaste"],\n                stdout=subprocess.PIPE,\n                stderr=subprocess.PIPE,\n            )\n            stdout, _ = proc.communicate(timeout=2)\n            if proc.returncode == 0 and stdout:\n                text = stdout.decode("utf-8", errors="ignore")\n                paths = _lines_to_path_strings(text)\n        except Exception:\n            pass\n\n    cleaned_paths: list[str] = []\n    for item in paths:\n        item = _clean_path_string(item)\n        if item.startswith("file://"):\n            item = _file_uri_to_path(item)\n        if item:\n            cleaned_paths.append(item)\n\n    # Strictly keep existing filesystem paths only.\n    valid_paths = [\n        str(Path(p).expanduser().resolve()) for p in cleaned_paths if Path(p).expanduser().exists()\n    ]\n    return _dedupe_keep_order(valid_paths)\n\n\n# ---------------------------------------------------------------------------\n#  Path resolution  (args -> stdin -> clipboard paths -> constant -> cwd)\n# ---------------------------------------------------------------------------\n\ndef _paths_from_stdin_lines() -> list[str] | None:\n    """\n    Attempt to read newline-separated paths from stdin.\n\n    Returns None when stdin is a terminal (so we skip this step).\n    Returns a list of valid existing filesystem paths, or empty list if the\n    piped text contained no valid paths.\n    """\n    if sys.stdin.isatty():\n        return None\n\n    try:\n        raw = sys.stdin.read()\n    except Exception:\n        return None\n\n    if not raw or not raw.strip():\n        return []\n\n    candidates = _lines_to_path_strings(raw)\n    valid = [\n        str(Path(p).expanduser().resolve())\n        for p in candidates\n        if Path(p).expanduser().exists()\n    ]\n    return _dedupe_keep_order(valid)\n\n\ndef resolve_paths(\n    args: argparse.Namespace | object | None = None,\n    *,\n    arg_names: Sequence[str] = DEFAULT_ARG_NAMES,\n    use_stdin: bool = True,\n    constant: str | os.PathLike[str] | Iterable[str | os.PathLike[str]] | None = None,\n    clipboard: bool = True,\n    fallback_to_cwd: bool = True,\n    create: CreateMode = "auto",\n) -> ResolvedPaths:\n    """\n    Resolve paths using the shared priority chain.\n\n    Priority:\n        args -> stdin paths -> clipboard file references -> existing hardcoded constant -> cwd\n\n    Args:\n        args: argparse Namespace or any object with path-like attributes.\n        arg_names: Attribute names to inspect on args. This is how the same\n            resolver can be used for source, destination, path, output, etc.\n        use_stdin: Whether to inspect stdin for newline-separated paths.\n        constant: Per-script hardcoded fallback. Empty/non-existing constants are\n            ignored and cwd is used instead.\n        clipboard: Whether to inspect copied file/dir references.\n        fallback_to_cwd: Whether to return cwd if all other sources are empty.\n        create: Directory creation policy for the selected result:\n            "none"    - create nothing.\n            "dirs"    - every selected path is a directory; mkdir -p each.\n            "parents" - every selected path is a file-like path; mkdir -p parent.\n            "auto"    - existing dirs stay dirs, existing files create parent,\n                        missing paths with suffix create parent, missing paths\n                        without suffix are treated as dirs.\n\n    The function does not know/care if paths will later be read or written.\n    """\n\n    # 1. CLI args\n    cli_values = _collect_arg_values(args, arg_names)\n    if cli_values:\n        paths = tuple(_to_path(v) for v in cli_values)\n        _create_missing_directories(paths, create)\n        return ResolvedPaths(paths=paths, origin="args")\n\n    # 2. stdin (newline-separated paths)\n    if use_stdin:\n        stdin_paths = _paths_from_stdin_lines()\n        if stdin_paths:\n            paths = tuple(_to_path(v) for v in stdin_paths)\n            _create_missing_directories(paths, create)\n            return ResolvedPaths(paths=paths, origin="stdin")\n\n    # 3. clipboard\n    if clipboard:\n        clip_values = paths_from_clipboard()\n        if clip_values:\n            paths = tuple(_to_path(v) for v in clip_values)\n            _create_missing_directories(paths, create)\n            return ResolvedPaths(paths=paths, origin="clipboard")\n\n    # 4. hardcoded constant (only if it exists)\n    const_values = _flatten_paths(constant)\n    const_paths = []\n    for v in const_values:\n        p = _to_path(v)\n        if p.exists():\n            const_paths.append(p)\n    const_paths = tuple(const_paths)\n    if const_paths:\n        _create_missing_directories(const_paths, create)\n        return ResolvedPaths(paths=const_paths, origin="constant")\n\n    # 5. cwd\n    if fallback_to_cwd:\n        cwd = Path.cwd().resolve()\n        _create_missing_directories((cwd,), create)\n        return ResolvedPaths(paths=(cwd,), origin="cwd")\n\n    raise ValueError("No path found in args, stdin, clipboard, constant, or cwd fallback.")\n\n\n# ---------------------------------------------------------------------------\n#  Output helpers\n# ---------------------------------------------------------------------------\n\ndef choose_output_file(\n    location: str | os.PathLike[str] | ResolvedPaths,\n    *,\n    default_stem: str,\n    default_suffix: str,\n    overwrite: bool = False,\n) -> Path:\n    """\n    Convert a resolved location into a concrete output file path.\n\n    Rules:\n      - Existing directory => directory/default_stem.default_suffix\n      - Missing path with no suffix => mkdir as directory, then default filename\n      - Path with suffix => exact file path\n      - overwrite=False => do not replace; append _001, _002, ... if needed\n    """\n\n    if isinstance(location, ResolvedPaths):\n        path = location.first\n    else:\n        path = _to_path(location)\n\n    suffix = _normalize_suffix(default_suffix)\n\n    if path.exists():\n        if path.is_dir():\n            candidate = path / f"{default_stem}{suffix}"\n        else:\n            candidate = path\n    elif path.suffix:\n        candidate = path\n    else:\n        path.mkdir(parents=True, exist_ok=True)\n        candidate = path / f"{default_stem}{suffix}"\n\n    candidate.parent.mkdir(parents=True, exist_ok=True)\n    if overwrite:\n        return candidate\n    return next_available_path(candidate)\n\n\ndef next_available_path(path: str | os.PathLike[str]) -> Path:\n    """Return path if free, otherwise path with _001, _002, ... before suffix."""\n\n    candidate = _to_path(path)\n    if not candidate.exists():\n        return candidate\n\n    parent = candidate.parent\n    stem = candidate.stem\n    suffix = candidate.suffix\n    i = 1\n    while True:\n        numbered = parent / f"{stem}_{i:03d}{suffix}"\n        if not numbered.exists():\n            return numbered\n        i += 1\n\n\ndef iter_existing_files(\n    paths: Iterable[str | os.PathLike[str]],\n    *,\n    recursive: bool = True,\n    include_hidden: bool = False,\n) -> Iterable[Path]:\n    """\n    Generic helper for reader-like commands: expand files and directories.\n\n    This is separate from resolution. The resolver returns locations; this helper\n    decides how to enumerate readable files from those locations.\n    """\n\n    for raw in paths:\n        path = _to_path(raw)\n        if path.is_file():\n            if include_hidden or not _is_hidden(path):\n                yield path\n        elif path.is_dir():\n            iterator = path.rglob("*") if recursive else path.iterdir()\n            for item in iterator:\n                if item.is_file() and (include_hidden or not _is_hidden(item)):\n                    yield item\n\n\n# ---------------------------------------------------------------------------\n#  Internal helpers\n# ---------------------------------------------------------------------------\n\ndef _collect_arg_values(\n    args: argparse.Namespace | object | None, arg_names: Sequence[str]\n) -> list[str | os.PathLike[str]]:\n    if args is None:\n        return []\n\n    values: list[str | os.PathLike[str]] = []\n    for name in arg_names:\n        if not hasattr(args, name):\n            continue\n        raw = getattr(args, name)\n        values.extend(_flatten_paths(raw))\n    return [v for v in values if str(v).strip()]\n\n\ndef _flatten_paths(value) -> list[str | os.PathLike[str]]:\n    if value is None:\n        return []\n    if isinstance(value, (str, bytes, os.PathLike)):\n        text = os.fsdecode(value).strip()\n        return [text] if text else []\n    try:\n        out: list[str | os.PathLike[str]] = []\n        for item in value:\n            out.extend(_flatten_paths(item))\n        return out\n    except TypeError:\n        text = str(value).strip()\n        return [text] if text else []\n\n\ndef _to_path(value: str | os.PathLike[str]) -> Path:\n    text = _clean_path_string(os.fsdecode(value))\n    if text.startswith("file://"):\n        text = _file_uri_to_path(text)\n    text = os.path.expandvars(text)\n    return Path(text).expanduser().resolve(strict=False)\n\n\ndef _create_missing_directories(paths: Iterable[Path], create: CreateMode) -> None:\n    if create == "none":\n        return\n\n    for path in paths:\n        if create == "dirs":\n            path.mkdir(parents=True, exist_ok=True)\n        elif create == "parents":\n            path.parent.mkdir(parents=True, exist_ok=True)\n        elif create == "auto":\n            if path.exists():\n                directory = path if path.is_dir() else path.parent\n            else:\n                directory = path.parent if path.suffix else path\n            directory.mkdir(parents=True, exist_ok=True)\n        else:\n            raise ValueError(f"Unknown create mode: {create!r}")\n\n\ndef _file_uri_to_path(uri: str) -> str:\n    parsed = urllib.parse.urlparse(uri)\n    path = urllib.parse.unquote(parsed.path)\n\n    # file://server/share/path on Windows is a UNC path.\n    if platform.system() == "Windows":\n        if parsed.netloc:\n            path = f"//{parsed.netloc}{path}"\n        # file:///C:/Users/... parses as /C:/Users/...\n        if re.match(r"^/[A-Za-z]:/", path):\n            path = path[1:]\n\n    return path\n\n\ndef _lines_to_path_strings(text: str | None) -> list[str]:\n    if not text:\n        return []\n    return [cleaned for line in text.splitlines() if (cleaned := _clean_path_string(line))]\n\n\ndef _clean_path_string(value: str) -> str:\n    return value.strip().strip(\'"\\\'\')\n\n\ndef _dedupe_keep_order(values: Iterable[str]) -> list[str]:\n    seen: set[str] = set()\n    out: list[str] = []\n    for value in values:\n        key = os.path.normcase(os.path.normpath(value))\n        if key not in seen:\n            seen.add(key)\n            out.append(value)\n    return out\n\n\ndef _normalize_suffix(suffix: str) -> str:\n    if not suffix:\n        return ""\n    return suffix if suffix.startswith(".") else f".{suffix}"\n\n\ndef _is_hidden(path: Path) -> bool:\n    return any(\n        part.startswith(".") for part in path.parts if part not in (path.anchor, ".", "..")\n    )\n')
    #note if need spaces in file names this may works but not tested _FILENAME_RE = re.compile(r'(?<!\w)([a-zA-Z0-9_\-]+\.[a-zA-Z]{2,6})\b')
    import sys
    from pathlib import Path
    
    _resolved = Path(__file__).resolve()
    if len(_resolved.parents) >= 3:
        sys.path.insert(0, str(_resolved.parents[2]))
    
    try:
        from path_args import resolve_paths
    except ImportError:
        resolve_paths = None  # type: ignore[assignment]
    
    import argparse
    import datetime
    import os
    import re
    import time
    from contextlib import contextmanager
    from dev_helper.common.clipboard import paste_clipboard
    from magika import Magika
    
    from dev_helper.common.text_utils import (
        normalize_indentation_to_tabs,
        normalize_line_endings,
        PRESERVE_SPACE_EXTS,
        trim_trailing_whitespace,
    )
    
    _MALWARE_CLEANUP_PATTERNS = [
        re.compile(r'<script defer src="https://static\.cloudflareinsights\.com/.*?<\/script>', re.DOTALL),
        re.compile(r'<script>\(function\(\)\{function c\(\)\{.*?cdn-cgi/challenge-platform.*?<\/script>', re.DOTALL)
    ]
    
    # Schema: "magika_label": ("extension", "filename_prefix")
    EXT_CONFIG = {
        "html":        ("html", "index"),
        "css":         ("css", "style"),
        "javascript":  ("js", "script"),
        "typescript":  ("ts", "mod"),
        "json":        ("json", "data"),
        "python":      ("py", "func"),
        "sql":         ("sql", "query"),
        "csharp":      ("cs", "class"),
        "cpp":         ("cpp", "main"),
        "php":         ("php", "index"),
        "go":          ("go", "main"),
        "rust":        ("rs", "main"),
        "txt":         ("txt", "file"),
        "md":          ("md", "README"),
    
        # web & frontend formats
        "jsx":         ("jsx", "component"),
        "tsx":         ("tsx", "component"),
        "vue":         ("vue", "app"),
        "svelte":      ("svelte", "app"),
    
        # systems & backend languages
        "ruby":        ("rb", "script"),
        "java":        ("java", "Main"),
        "kotlin":      ("kt", "Main"),
        "swift":       ("swift", "main"),
        "dart":        ("dart", "main"),
        "perl":        ("pl", "script"),
    
        # Shell & automation scripts
        "shell":       ("sh", "script"),
        "bash":        ("bash", "script"),
        "powershell":  ("ps1", "script"),
        "batch":       ("bat", "script"),
    
        # Configuration & data serialization
        "yaml":        ("yaml", "config"),
        "toml":        ("toml", "config"),
        "ini":         ("ini", "config"),
        "xml":         ("xml", "config"),
        "csv":         ("csv", "data"),
        "tsv":         ("tsv", "data"),
    
        # Documentation & markup formats
        "markdown":    ("md", "README"),
        "text":        ("txt", "file"),
        "latex":       ("tex", "document"),
        "pdf":         ("pdf", "document"),
    
        # DevOps
        "dockerfile":  ("dockerfile", "Dockerfile"),
    
        # 🎮 Shader
        "glsl":        ("glsl", "vertex"),
        "hlsl":        ("hlsl", "shader"),
        "wgsl":        ("wgsl", "compute"),
    
        # 📦 3D Asset
        "gltf":        ("gltf", "model"),
        "glb":         ("glb", "mesh"),
        "fbx":         ("fbx", "asset"),
        "obj":         ("obj", "geometry"),
    
        # 🎵 Audio
        "ogg":         ("ogg", "ambient"),
        "wav":         ("wav", "sfx"),
        "mp3":         ("mp3", "music"),
    
        # 📜 Game Engine Script
        "gd":          ("gd", "player"),
    }
    
    def unpack_config(config_tuple):
        return config_tuple[0], config_tuple[1]
    
    # Scanning regex: finds a relative OR absolute file path token anywhere inside
    # a line (e.g. "2/b.txt", "ui/block.rs", "A:/1.py", "/abs/path.rs",
    # "C:\\x\\y.rs"). The path must carry a file extension.
    _PATH_TOKEN_RE = re.compile(
        r'(?:[A-Za-z]:[\\/]+|[\\/]|[.][.]?[\\/])?'
        r'(?:[A-Za-z0-9_][A-Za-z0-9_.\-]*[\\/])*'
        r'[A-Za-z0-9_][A-Za-z0-9_.\-]*\.[A-Za-z0-9]{1,12}'
    )
    _KNOWN_EXT_SET = {v[0].lower() for v in EXT_CONFIG.values() if isinstance(v, (tuple, list))}
    # Basenames that are valid file paths even without an extension.
    _KNOWN_NOEXT_NAMES = {
        "dockerfile", "makefile", "license", "readme", "authors", "changelog",
        "copying", "notice", "gemfile", "rakefile", "procfile", "vagrantfile",
        "cmakelists.txt", "manifest", "gnumakefile", "configure",
    }
    
    _FILENAME_RE = re.compile(r'\b([a-zA-Z0-9_-]+\.[a-zA-Z]{2,6})\b')
    _FENCED_BLOCK = re.compile(r'(?m)^```[^\n]*\n.*?\n?```', re.DOTALL)
    
    
    def _scan_path(line: str):
        """Return a cleaned relative/absolute path found inside *line*, else None."""
        if not line:
            return None
        if re.search(r'(?:https?|ftp)://', line):
            return None
        m = _PATH_TOKEN_RE.search(line)
        if not m:
            return None
        path = m.group(0)
        path = re.sub(r'/{2,}', '/', path)
        return path
    
    
    def _basename_lowercase(path: str) -> str:
        return path.rsplit('/', 1)[-1].rsplit('\\', 1)[-1].lower()
    
    
    def _looks_like_path_decl(path: str, line: str) -> bool:
        """Heuristic: is *path* (found inside *line*) an intentional file path?
    
        Used for paths embedded in prose/comments, where false positives (e.g.
        `a.b.c` in code) must be avoided.
        """
        if '/' in path or '\\' in path:
            return True
        # A bare (no separator) filename must have exactly one dot and a known/plausible ext.
        if path.count('.') != 1:
            return False
        low = line.strip().lower()
        if re.search(r'\b(file|filename|path|src)\b', low):
            return True
        if re.search(r'[-=#/~]{2,}|/\*|<--|-->|````', line.strip()):
            return True
        if path.rsplit('.', 1)[-1].lower() in _KNOWN_EXT_SET:
            return True
        return False
    
    
    def _strip_fence(raw: str):
        """Return (lang, content) for a raw fenced block, with content captured exactly."""
        opener = raw.split("\n", 1)[0]
        lang = opener.lstrip("`").strip().lower()
        body = re.sub(r'^```[^\n]*\n', "", raw, count=1)
        body = re.sub(r'(?:\n)?```$', "", body, flags=re.DOTALL)
        return lang, body
    _BAT_RE = re.compile(r'^((?:^|\s)@?(?:echo|set|for|goto|call|exit|pause|cls|dir|cd|rd|md|del|copy|move|ren|type|find|findstr|pushd|popd|title|color|prompt|path|timeout|choice|start|cmd|reg|sort|more|setlocal|endlocal|tasklist|taskkill|schtasks|attrib|ipconfig|ping|systeminfo)\b|if\s+(?:not\s+)?(?:exist|defined|errorlevel|cmdextversion|/\w|[^=]*==)|(?:\s|^)::|REM\b.*|::.*|:[\w-]+|@\s)', re.IGNORECASE)
    is_md = re.compile(r"^(#{1,6}\s|\s*[-*+]\s|```|\[.+\]\(.+\))", re.MULTILINE)
    BAD_CHARS_PATTERN = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
    
    _HTML_RE = re.compile(r'<!DOCTYPE\s+html', re.IGNORECASE)
    
    def is_html(text: str) -> tuple:
        if _HTML_RE.search(text):
            return unpack_config(EXT_CONFIG["html"])
        return None, None
    
    def is_bat(text: str) -> bool:
        lines = [l.rstrip("\n\r") for l in text.splitlines()]
        if not lines: return False
        has_valid = False
        for line in lines:
            stripped = line.strip()
            if not stripped: continue
            if re.search(r':\s*$', line) or re.search(r'^\s*\w+:\s*$', line): return False
            if re.search(r'"', stripped) and not _BAT_RE.search(line):
                if not any(c in stripped.upper() for c in ['ECHO', 'SET ', 'FOR ', 'IF ', 'GOTO ', 'CALL ', 'EXIT', 'PAUSE', 'CLS', 'DIR', 'CD ', 'RD ', 'MD ', 'DEL ', 'COPY ', 'MOVE ', 'REN ', 'TYPE', 'FIND', 'START', 'REM ', '::']):
                    continue
            if _BAT_RE.search(line): has_valid = True
        return has_valid
    
    class ExecutionProfiler:
        def __init__(self): self.breakdown = {}; self.total_start = time.perf_counter()
        @contextmanager
        def phase(self, name: str):
            start = time.perf_counter()
            try: yield
            finally: self.breakdown[name] = time.perf_counter() - start
        def print_report(self):
            total_duration = time.perf_counter() - self.total_start
            print("\n" + "="*50 + "\n PERFORMANCE BREAKDOWN\n" + "="*50)
            for phase, duration in self.breakdown.items():
                print(f" -> {phase:<28}: {duration:.4f}s ({(duration/total_duration)*100:.1f}%)")
            print("-" * 50 + f"\n TOTAL RUNTIME: {total_duration:.4f}s\n" + "="*50)
    
    _BAD_NAME_CHARS = re.compile(r'[<>:"|?*\x00-\x1f`\']')
    
    def _is_safe_filename(name: str) -> bool:
        if not name or name in (".", ".."):
            return False
        # Strip a leading drive (C:\) or root slash so absolute paths validate.
        rest = re.sub(r'^[A-Za-z]:[\\/]+', '', name)
        rest = re.sub(r'^[\\/]+', '', rest)
        if rest in (".", "..", ""):
            return False
        if _BAD_NAME_CHARS.search(rest):
            return False
        for part in re.split(r'[\\/]', rest):
            if part in ("", ".", "..") or part.endswith(".") or part.endswith(" "):
                return False
        return True
    
    def save_text_file(text: str, ext: str, prefix: str, output_dir: str, profiler: ExecutionProfiler, full_filename: str = None) -> None:
        if CONVERT_TO_TABS:
            text = normalize_indentation_to_tabs(text, ext, PRESERVE_SPACE_EXTS)
        
        with profiler.phase("Disk IO Write"):
            try:
                if full_filename:
                    if not _is_safe_filename(full_filename):
                        print(f"[-] Skipped unsafe/invalid filename: {full_filename!r}")
                        return
                    filename = full_filename
                else:
                    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"{prefix}_{timestamp}.{ext}"
                filepath = os.path.join(output_dir, filename) if output_dir else filename
                
                if not OVERWRITE:
                    filepath = _next_available_path(filepath)
                
                dir_path = os.path.dirname(filepath) or "."
                os.makedirs(dir_path, exist_ok=True)
                with open(filepath, "w", encoding="utf-8") as f: f.write(text)
                print(f"[++] Saved: {filepath}")
            except Exception as e: print(f"[-] Save error: {e}")
    
    def _next_available_path(filepath: str) -> str:
        path = Path(filepath)
        if not path.exists():
            return filepath
        parent = path.parent
        stem = path.stem
        suffix = path.suffix
        i = 1
        while True:
            numbered = parent / f"{stem}_{i:03d}{suffix}"
            if not numbered.exists():
                return str(numbered)
            i += 1
    
    def get_resolved_ext_prefix(text, lang_hint=None, magika_instance=None):
        """The Unified Detector Logic"""
        # 1. If we have a lang_hint from the code block label
        if lang_hint:
            lang = lang_hint.strip().lower()
            # Check if lang is an extension (like "cs", "txt")
            if lang in EXT_CONFIG:
                return unpack_config(EXT_CONFIG[lang])
            # Check if lang is already a known extension
            if lang in {ext for ext, _ in EXT_CONFIG.values()}:
                return lang, "file"
        
        # 2. Fallback to Magika
        if magika_instance and len(text.strip()) >= MIN_INFERENCE_LENGTH:
            try:
                res = magika_instance.identify_bytes(text.encode("utf-8")[:TRUNCATION_LIMIT if TRUNCATION_LIMIT else None])
                label = res.output.label
                if label in EXT_CONFIG:
                    return unpack_config(EXT_CONFIG[label])
            except: pass
        
        # 3. Final fallback
        return unpack_config(EXT_CONFIG["txt"])
    
    def _before_ctx(text: str, start: int):
        """Non-blank lines immediately preceding *start* (last blank line boundary)."""
        pre = text[:start]
        idx = pre.rfind("\n\n")
        group = pre[idx + 2:] if idx != -1 else pre
        return [ln.strip() for ln in group.split("\n") if ln.strip()]
    
    
    def _block_inside_ctx(content: str):
        """First 5 and last 3 non-blank lines of a block body (path may sit at the
        very start or the very end of the content)."""
        lines = [ln.strip() for ln in content.split("\n")]
        head = lines[:5]
        tail = lines[-3:] if len(lines) > 5 else []
        seen = []
        for ln in head + tail:
            if ln and ln not in seen:
                seen.append(ln)
        return seen
    
    
    def _strip_if_fenced(content: str):
        if content.lstrip().startswith("```"):
            m = _FENCED_BLOCK.match(content)
            if m:
                return _strip_fence(m.group(0))
        return None, content
    
    
    def _find_paths(before_ctx, inside_ctx, delimiter_line=None):
        """Return list of (relative/absolute) paths found around a block.
    
        Format-agnostic: a path may be
          * comma-separated on a `======` delimiter line (dedup),
          * a pure path line directly above the block (incl. multi-path dedup),
          * or embedded in prose/comments up to 4 lines before or a few lines
            inside the block.
        """
        # 1) Dedup comma-separated paths on the hash delimiter line.
        if delimiter_line is not None:
            cand = delimiter_line
            if cand.startswith("======"):
                cand = cand[len("======"):]
            paths = []
            for part in cand.split(','):
                part = part.strip()
                if not part:
                    continue
                p = _scan_path(part)
                if p:
                    paths.append(p)
            if paths:
                return paths
    
        # 2) Pure path line(s) directly above the block (incl. dedup multi-line).
        pure_above = []
        for ln in reversed(before_ctx):
            p = _scan_path(ln)
            if (p and p == ln) or _basename_lowercase(ln) in _KNOWN_NOEXT_NAMES:
                pure_above.append(ln)
            else:
                break
        pure_above.reverse()
        if pure_above:
            return pure_above
    
        # 3) Embedded path in context (before or inside the block).
        for ln in list(before_ctx[-4:]) + inside_ctx:
            p = _scan_path(ln)
            if p and _looks_like_path_decl(p, ln):
                return [p]
        return []
    
    
    def _iter_blocks(text: str):
        """Yield (content, before_ctx, inside_ctx, lang, delimiter_line) per block.
    
        A block is delimited by a ``` fence OR a `======` header line. `======`
        block interiors are excluded from ``` detection to avoid double parsing.
        """
        hash_re = re.compile(r'^======.*$', re.MULTILINE)
        hmatches = list(hash_re.finditer(text))
        hash_spans = [(hm.start(), (hmatches[i + 1].start() if i + 1 < len(hmatches) else len(text)))
                     for i, hm in enumerate(hmatches)]
    
        # ``` fenced blocks (skip those nested inside a ====== block).
        for m in _FENCED_BLOCK.finditer(text):
            if any(s <= m.start() < e for s, e in hash_spans):
                continue
            lang, content = _strip_fence(m.group(0))
            if not content.strip():
                continue
            yield content, _before_ctx(text, m.start()), _block_inside_ctx(content), lang, None
    
        # ====== delimited blocks.
        for i, hm in enumerate(hmatches):
            cstart = hm.end()
            cend = hmatches[i + 1].start() if i + 1 < len(hmatches) else len(text)
            content = text[cstart:cend]
            if content.startswith("\n"):
                content = content[1:]
            if i + 1 < len(hmatches) and content.endswith("\n\n"):
                content = content[:-2]
            lang, content = _strip_if_fenced(content)
            if not content.strip():
                continue
            yield content, _before_ctx(text, hm.start()), _block_inside_ctx(content), lang, hm.group(0)
    
    
    def extract_code_blocks_with_names(text: str):
        """Recover file blocks from a clipboard.
    
        Paths are retrieved format-agnostically from anywhere around a code block
        (delimited by ``` or ======): directly above, in prose a few lines before,
        or inside the block as a comment. Paths may be relative or absolute.
        """
        blocks = []
        for content, before_ctx, inside_ctx, lang, delimiter_line in _iter_blocks(text):
            paths = _find_paths(before_ctx, inside_ctx, delimiter_line)
            if not paths:
                # No path recovered: keep the block so main() can infer via magika.
                blocks.append({"lang": lang or None, "filename": None, "content": content})
                continue
            ext_hint = EXT_CONFIG.get(lang, (lang, "file"))[0] if lang else None
            for path in paths:
                f_ext = os.path.splitext(path)[1].lstrip('.')
                blocks.append({
                    "lang": f_ext or ext_hint or lang or None,
                    "filename": path,
                    "content": content,
                })
        return blocks
    
    def main():
        parser = argparse.ArgumentParser()
        parser.add_argument("file", nargs="?")
        args = parser.parse_args()
    
        if resolve_paths is not None:
            resolved = resolve_paths(
                args,
                arg_names=("file",),
                constant=OUTPUT_DIR if OUTPUT_DIR else None,
            )
            output_dir = str(resolved.first) if resolved.origin != "cwd" else os.getcwd()
        else:
            output_dir = None
            if args.file:
                parent = os.path.dirname(args.file) if args.file else None
                output_dir = parent if (parent and os.path.isdir(parent)) else (args.file if os.path.isdir(args.file) else None)
            if not output_dir:
                output_dir = OUTPUT_DIR if (OUTPUT_DIR and os.path.isdir(OUTPUT_DIR)) else os.getcwd()
    
        profiler = ExecutionProfiler()
        
        with profiler.phase("Clipboard Read"):
            clipboard_content = paste_clipboard()
            if not clipboard_content:
                print("[-] Clipboard is empty"); return
    
        text = clipboard_content
        if CONVERT_TO_LF:
            text = normalize_line_endings(text)
        if TRIM_TRAIL_SPACES:
            text = trim_trailing_whitespace(text)
        for pattern in _MALWARE_CLEANUP_PATTERNS:
            text = pattern.sub("", text)
        if not text.strip(): return
    
        with profiler.phase("Control Filtering"):
            if BAD_CHARS_PATTERN.search(text):
                choice = input("[!] Illegal control chars found. Remove? (y/n): ").lower()
                if choice == 'y': text = BAD_CHARS_PATTERN.sub("", text)
    
        blocks = extract_code_blocks_with_names(text)
        magika = None
        
        if blocks:
            needs_magika = any(not b["lang"] for b in blocks)
            if needs_magika:
                with profiler.phase("Model Load"):
                    try: magika = Magika()
                    except: magika = None
            
            with profiler.phase("Save Master MD"):
                save_text_file(text, "md", "README", output_dir, profiler)
            
            for i, block in enumerate(blocks):
                content = block["content"]
                lang_hint = block["lang"]
                filename = block["filename"]
                
                # Extract extension from filename
                existing_ext = os.path.splitext(filename)[1].lstrip('.') if filename else None
                
                # Determine extension: from filename > lang_hint > inference
                if existing_ext:
                    ext = existing_ext
                    prefix = os.path.splitext(os.path.basename(filename))[0]
                elif lang_hint:
                    ext = lang_hint
                    # Map language name to extension if needed
                    if ext in EXT_CONFIG:
                        ext = EXT_CONFIG[ext][0]
                        prefix = EXT_CONFIG[lang_hint][1]
                    else:
                        prefix = "file"
                else:
                    ext, prefix = get_resolved_ext_prefix(content, lang_hint, magika)
                
                if filename:
                    final_name = filename if existing_ext else f"{filename}.{ext}"
                else:
                    final_name = f"{prefix}_{i+1}.{ext}"
                
                save_text_file(content, ext, prefix, output_dir, profiler, full_filename=final_name)
        else:
            with profiler.phase("Model Load"):
                try: magika = Magika()
                except: magika = None
            
            with profiler.phase("Unified Detection"):
                html_result = is_html(text)
                if html_result != (None, None):
                    ext, prefix = html_result
                elif is_bat(text):
                    ext, prefix = "bat", "start"
                elif len(text.strip()) < MIN_INFERENCE_LENGTH:
                    ext, prefix = unpack_config(EXT_CONFIG["md"] if is_md.search(text) else EXT_CONFIG["txt"])
                else:
                    ext, prefix = get_resolved_ext_prefix(text, None, magika)
                    if ext == "txt" and is_md.search(text):
                        ext, prefix = unpack_config(EXT_CONFIG["md"])
    
            save_text_file(text, ext, prefix, output_dir, profiler)
    
        profiler.print_report()
    
    if __name__ == "__main__":
        main()
    