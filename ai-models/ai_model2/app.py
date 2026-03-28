from flask import Flask, request, jsonify
from src.inference import run_inference

app = Flask(__name__)


@app.route("/infer", methods=["POST"])
def infer():
    data = request.json

    expert_data = data.get("expert")
    worker_data = data.get("worker")

    if not expert_data or not worker_data:
        return jsonify({"error": "Missing data"}), 400

    result = run_inference(expert_data, worker_data)

    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)