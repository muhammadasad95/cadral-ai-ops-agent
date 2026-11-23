# Hugging Face Space launcher (Gradio SDK, free CPU tier).
# Downloads Node 22, clones the app from GitHub, builds it and starts the server on port 7860.
# Source of truth: https://github.com/muhammadasad95/cadral-ai-ops-agent
import os
import pathlib
import secrets
import subprocess
import tarfile
import urllib.request

import spaces  # ZeroGPU (the free tier for Gradio Spaces) needs one @spaces.GPU function at startup


@spaces.GPU
def _gpu_noop():
    return None


NODE = "v22.12.0"
REPO = os.environ.get("APP_REPO", "https://github.com/muhammadasad95/cadral-ai-ops-agent")
BRANCH = os.environ.get("APP_BRANCH", "main")
work = pathlib.Path(os.environ.get("APP_WORKDIR", "/tmp/cadral"))
node_dir = work / "node"
app_dir = work / "app"
work.mkdir(parents=True, exist_ok=True)

if not (node_dir / "bin" / "node").exists():
    print("Downloading Node", NODE, flush=True)
    archive = work / "node.tar.xz"
    urllib.request.urlretrieve(f"https://nodejs.org/dist/{NODE}/node-{NODE}-linux-x64.tar.xz", archive)
    with tarfile.open(archive) as t:
        t.extractall(work)
    (work / f"node-{NODE}-linux-x64").rename(node_dir)

env = dict(os.environ)
env["PATH"] = f"{node_dir / 'bin'}:{env.get('PATH', '')}"
env.setdefault("PORT", "7860")
env.setdefault("HF_HOME", str(work / "hf-cache"))
env.setdefault("PGLITE_DIR", str(work / "pglite"))
env.setdefault("NODE_ENV", "production")
# Random per-boot secrets unless set in the Space settings (never fall back to the dev default).
env.setdefault("JWT_SECRET", secrets.token_hex(32))
env.setdefault("CRON_KEY", secrets.token_hex(16))

if app_dir.exists():
    subprocess.run(["git", "-C", str(app_dir), "pull", "--ff-only"], check=False)
else:
    subprocess.run(["git", "clone", "--depth", "1", "-b", BRANCH, REPO, str(app_dir)], check=True)


def sh(cmd: str) -> None:
    print("$", cmd, flush=True)
    subprocess.run(cmd, shell=True, check=True, cwd=app_dir, env=env)


sh("npm install --include=dev --no-audit --no-fund")
sh("npm run build:web")
sh("npx tsx data/make-docs.ts")

# ZeroGPU registers @spaces.GPU functions when a Gradio app launches; run a tiny one on a side port.
import gradio as gr  # noqa: E402

with gr.Blocks() as _status:
    gr.Markdown("Cadral AI Ops Agent is served on the main URL.")
    gr.Button("noop").click(_gpu_noop)
_status.launch(server_name="127.0.0.1", server_port=7861, prevent_thread_lock=True, show_error=True)

npx = str(node_dir / "bin" / "npx")
raise SystemExit(subprocess.run([npx, "tsx", "server/src/main.ts"], cwd=app_dir, env=env).returncode)
