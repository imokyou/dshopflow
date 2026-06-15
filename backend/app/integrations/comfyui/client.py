import uuid
import httpx
import json
from app.config import settings


class ComfyUIClient:
    def __init__(self):
        self.base_url = settings.COMFYUI_BASE_URL

    async def queue_prompt(self, workflow: dict) -> str:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self.base_url}/prompt",
                json={"prompt": workflow, "client_id": str(uuid.uuid4())}
            )
            resp.raise_for_status()
            return resp.json()["prompt_id"]

    async def wait_for_completion(self, prompt_id: str, timeout: int = 300) -> dict:
        import asyncio
        start = asyncio.get_event_loop().time()
        while True:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{self.base_url}/history/{prompt_id}")
                if resp.status_code == 200:
                    data = resp.json()
                    if prompt_id in data:
                        return data[prompt_id]["outputs"]
            if asyncio.get_event_loop().time() - start > timeout:
                raise TimeoutError(f"ComfyUI prompt {prompt_id} timed out")
            await asyncio.sleep(2)

    async def process_image(self, workflow_template: dict, inputs: dict) -> dict:
        workflow = json.loads(json.dumps(workflow_template))
        for node_id, node_data in workflow.items():
            if "inputs" in node_data:
                for key, value in node_data["inputs"].items():
                    if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
                        placeholder = value[2:-2].strip()
                        if placeholder in inputs:
                            node_data["inputs"][key] = inputs[placeholder]

        prompt_id = await self.queue_prompt(workflow)
        return await self.wait_for_completion(prompt_id)

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/system_stats")
                return resp.status_code == 200
        except Exception:
            return False
