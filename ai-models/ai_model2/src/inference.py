from src.error_detection import detect_error


def run_inference(expert_data, worker_data):
    """
    Main AI entry point (this is what backend will call)
    """

    result = detect_error(expert_data, worker_data)

    # Convert error to alignment score (0 to 1)
    alignment_score = max(0, 1 - result["error"])

    output = {
        "type": "ai:feedback",
        "status": result["status"],
        "message": result["message"],
        "alignment_score": round(alignment_score, 2)
    }

    return output