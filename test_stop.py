import torch
from transformers import StoppingCriteria, StoppingCriteriaList

class StopCrit(StoppingCriteria):
    def __call__(self, input_ids, scores, **kwargs):
        return True # Try python bool

print("Testing bool return...")
