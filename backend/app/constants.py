from typing import Final

MAX_RESOURCE_NAME_LENGTH: Final[int] = 50
MIN_RESOURCE_NAME_LENGTH: Final[int] = 2
MAX_RESOURCES_PER_USER: Final[int] = 10
MAX_RESOURCE_SIZE_BYTES: Final[int] = 100 * 1024

REDIS_KEY_CHAT_STREAM_LIVE: Final[str] = "chat:{chat_id}:stream:live"
REDIS_KEY_USER_SETTINGS: Final[str] = "user_settings:{user_id}"
REDIS_KEY_CHAT_CONTEXT_USAGE: Final[str] = "chat:{chat_id}:context_usage"
REDIS_KEY_CHAT_QUEUE: Final[str] = "chat:{chat_id}:queue"
REDIS_KEY_CHAT_QUEUE_SEND_NOW: Final[str] = "chat:{chat_id}:queue:send_now"

QUEUE_MESSAGE_TTL_SECONDS: Final[int] = 3600

SANDBOX_AUTO_PAUSE_TIMEOUT: Final[int] = 3000
SANDBOX_DEFAULT_COMMAND_TIMEOUT: Final[int] = 120
SANDBOX_DEFAULT_TIMEOUT: Final[int] = 3600
LISTENING_PORTS_COMMAND: Final[str] = (
    "ss -tuln | grep LISTEN | awk '{print $5}' | sed 's/.*://g' | grep -E '^[0-9]+$' | sort -u"
)
MAX_CHECKPOINTS_PER_SANDBOX: Final[int] = 20
CHECKPOINT_BASE_DIR: Final[str] = "/home/user/.checkpoints"
PTY_OUTPUT_QUEUE_SIZE: Final[int] = 512
PTY_INPUT_QUEUE_SIZE: Final[int] = 1024

DOCKER_AVAILABLE_PORTS: Final[list[int]] = [
    3000,
    3001,
    5000,
    5900,
    6080,
    8000,
    8080,
    8765,
    5173,
    4200,
    8888,
    4321,
    3030,
    5500,
    1234,
    4000,
]

VNC_PORT: Final[int] = 5900
VNC_WEBSOCKET_PORT: Final[int] = 6080
OPENVSCODE_PORT: Final[int] = 8765
CHROME_DEVTOOLS_PORT: Final[int] = 9222

EXCLUDED_PREVIEW_PORTS: Final[set[int]] = {
    22,
    3456,
    4040,
    49982,
    49983,
    VNC_PORT,
    VNC_WEBSOCKET_PORT,
    OPENVSCODE_PORT,
    CHROME_DEVTOOLS_PORT,
}

SANDBOX_SYSTEM_VARIABLES: Final[list[str]] = [
    "SHELL",
    "PWD",
    "LOGNAME",
    "HOME",
    "USER",
    "SHLVL",
    "PS1",
    "PATH",
    "_",
    "NVM_DIR",
    "NODE_VERSION",
    "TERM",
]

SANDBOX_RESTORE_EXCLUDE_PATTERNS: Final[list[str]] = [
    ".checkpoints",
    ".cache",
    "__pycache__",
    "*.pyc",
    "*.pyo",
    "*.log",
    ".DS_Store",
    "dist",
    "build",
    ".next",
    ".nuxt",
]

SANDBOX_EXCLUDED_PATHS: Final[list[str]] = [
    "*/node_modules/*",
    "*/node_modules",
    "*/.*",
    "*/__pycache__/*",
    "*/__pycache__",
    "*.pyc",
    "*.log",
    "*/dist/*",
    "*/dist",
    "*/build/*",
    "*/build",
    "package-lock.json",
    "*/package-lock.json",
    "bun.lock",
    "*/bun.lock",
]

SANDBOX_BINARY_EXTENSIONS: Final[set[str]] = {
    "exe",
    "dll",
    "so",
    "dylib",
    "a",
    "lib",
    "obj",
    "o",
    "zip",
    "tar",
    "gz",
    "bz2",
    "xz",
    "7z",
    "rar",
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "ico",
    "tiff",
    "webp",
    "svg",
    "mp4",
    "avi",
    "mkv",
    "mov",
    "wmv",
    "flv",
    "webm",
    "mp3",
    "wav",
    "flac",
    "ogg",
    "wma",
    "aac",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "bin",
    "dat",
    "db",
    "sqlite",
    "sqlite3",
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    "class",
    "jar",
    "war",
    "ear",
    "pyc",
    "pyo",
    "pyd",
}

SANDBOX_HOME_DIR: Final[str] = "/home/user"
SANDBOX_CLAUDE_DIR: Final[str] = "/home/user/.claude"
SANDBOX_CLAUDE_JSON_PATH: Final[str] = "/home/user/.claude.json"
SANDBOX_GIT_ASKPASS_PATH: Final[str] = "/home/user/.git-askpass.sh"
SANDBOX_IDE_CONFIG_DIR: Final[str] = "/home/user/.openvscode-server/data/Machine"
SANDBOX_IDE_SETTINGS_PATH: Final[str] = (
    "/home/user/.openvscode-server/data/Machine/settings.json"
)
SANDBOX_IDE_TOKEN_PATH: Final[str] = "/home/user/.ide_connection_token"

WS_MSG_AUTH: Final[str] = "auth"
WS_MSG_INIT: Final[str] = "init"
WS_MSG_RESIZE: Final[str] = "resize"
WS_MSG_CLOSE: Final[str] = "close"
WS_MSG_PING: Final[str] = "ping"
WS_MSG_DETACH: Final[str] = "detach"

WS_CLOSE_AUTH_FAILED: Final[int] = 4001
WS_CLOSE_API_KEY_REQUIRED: Final[int] = 4003
WS_CLOSE_SANDBOX_NOT_FOUND: Final[int] = 4004

ANTHROPIC_BRIDGE_PORT: Final[int] = 3456
ANTHROPIC_BRIDGE_HOST: Final[str] = "0.0.0.0"

TERMINAL_TYPE: Final[str] = "xterm-256color"
DEFAULT_PTY_ROWS: Final[int] = 24
DEFAULT_PTY_COLS: Final[int] = 80
DOCKER_STATUS_RUNNING: Final[str] = "running"

SANDBOX_BASHRC_PATH: Final[str] = "/home/user/.bashrc"

STREAM_STATUS_CANCELLED: Final[str] = "cancelled"
