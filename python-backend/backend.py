from flask import Flask
from flask import request
from transformers import AutoModel
from huggingface_hub import snapshot_download
from flask_cors import CORS
import sys, os
import torch
torch.set_num_threads(os.cpu_count())
torch.backends.cudnn.benchmark = True

#print("Pre-warming librosa/numba cache...")
#import librosa.core.convert    # please make it work
#import librosa.core.notation
#print("Librosa ready.")


def load_songformer_model():
    local_dir = os.path.join(os.path.dirname(__file__), "songformer")
    sys.path.append(local_dir)
    os.environ["SONGFORMER_LOCAL_DIR"] = local_dir

    songformer = AutoModel.from_pretrained(
        local_dir,
        trust_remote_code=True,
        low_cpu_mem_usage=False,
    )
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
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
    print("segmenting file")
    if "file" not in request.files:
        print("failure: no file provided")
        return {"error": "no file provided"}, 400

    print("saving file")
    audio_file = request.files["file"]
    save_path = f"{audio_file.filename}"
    audio_file.save(save_path)

    print("computing")
    result = model(save_path)
    print("done")
    return result


if __name__ == "__main__":
    app.run(debug=True, port=3001)
