from flask import Flask
from flask import request
from transformers import AutoModel
from huggingface_hub import snapshot_download
from flask_cors import CORS
import sys, os


def load_songformer_model():
    try:
        local_dir = snapshot_download(
            repo_id="ASLP-lab/SongFormer",
            repo_type="model",
            local_dir_use_symlinks=False,
            allow_patterns="*",
            ignore_patterns=["SongFormer.pt", "SongFormer.safetensors"],
            local_files_only=True,   # never hits the network
        )
        print("Loaded from cache.")
    except Exception:
        print("Not cached — downloading...")
        local_dir = snapshot_download(
            repo_id="ASLP-lab/SongFormer",
            repo_type="model",
            local_dir_use_symlinks=False,
            allow_patterns="*",
            ignore_patterns=["SongFormer.pt", "SongFormer.safetensors"],)
        print("downloaded.")

    sys.path.append(local_dir)
    os.environ["SONGFORMER_LOCAL_DIR"] = local_dir

    songformer = AutoModel.from_pretrained(
        local_dir,
        trust_remote_code=True,
        low_cpu_mem_usage=False,
    )
    device = "cpu"          # was "cuda:0"
    songformer.to(device)
    songformer.eval()
    return songformer


app = Flask(__name__)
#CORS(app, origins=["http://localhost:3000"])
CORS(app)
print("Loading model...")
model = load_songformer_model()   # runs once, at startup
print("Model ready.")

@app.route("/segment", methods=["POST"])
def segment():
    if "file" not in request.files:
        return {"error": "no file provided"}, 400

    audio_file = request.files["file"]
    save_path = f"/tmp/{audio_file.filename}"
    audio_file.save(save_path)

    result = model(save_path)
    return result


if __name__ == "__main__":
    app.run(debug=True, port=3001)
