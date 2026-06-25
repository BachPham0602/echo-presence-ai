import traceback
from lumi.config import LumiConfig
from lumi.mvp_pipeline import LumiMvpPipeline

def main():
    p = LumiMvpPipeline(LumiConfig())
    try:
        p.handle_audio_file('outputs/web_input_1782264377900178449.wav')
    except Exception as e:
        traceback.print_exc()

if __name__ == "__main__":
    main()
