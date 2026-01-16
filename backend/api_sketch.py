# two agents communicating optimize communication protocal

import asyncio
import json
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional, Union

import tiktoken
from openai import AsyncOpenAI
from pydantic import BaseModel

client = AsyncOpenAI()

tokenizer = tiktoken.encoding_for_model("gpt-5")

EventCallback = Callable[[Dict], Union[Awaitable[None], None]]


class Agent:
    def __init__(self, role: str, name: str):
        self.role = role
        self.name = name
        self.communication_protocal = None
        self.prompt = None
    
    async def run(
        self,
        input: str,
        observer: Optional[EventCallback] = None,
    ) -> tuple[str, int]:
        communication_tokens = 0
        # Define tools for agent communication
        tools = [
            {
                "type": "function",
                "name": "communicate_with_agent",
                "description": "Send a message to another agent through the communication protocol.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "target_agent": {
                            "type": "string",
                            "description": "The name or role of the target agent to communicate with",
                        },
                        "message": {
                            "type": "string",
                            "description": "The message to send to the target agent",
                        },
                    },
                    "required": ["target_agent", "message"],
                },
            },
        ]
        
        # Create input list for the conversation
        input_list = [
            {"role": "system", "content": self.build_prompt()},
            {"role": "user", "content": input}
        ]
        
        # Prompt the model with tools defined
        response = await client.responses.create(
            model="gpt-5.2",
            reasoning={"effort": "low"},
            tools=tools,
            tool_choice="required",
            input=input_list,
        )
        
        # Save function call outputs for subsequent requests
        input_list += response.output
        original_function_call_item = None
        for item in response.output:
            if item.type == "function_call":
                original_function_call_item = item
                break
        assert original_function_call_item is not None, f"No function call found: {response.output}"
        # Execute the function logic for communicate_with_agent
        args = json.loads(original_function_call_item.arguments)
        # Find the other agent in the communication protocol (not self)
        target_agent = None
        for agent in self.communication_protocal.agents:
            if agent is not self:
                target_agent = agent
                break
        communication_tokens += len(tokenizer.encode(args['message']))
        if observer:
            await _maybe_await(
                observer(
                    {
                        "type": "agent_message",
                        "from": self.name,
                        "to": target_agent.name if target_agent else "unknown",
                        "direction": "outbound",
                        "message": args["message"],
                        "tokens": communication_tokens,
                    }
                )
            )
        if target_agent:
            # Build the target agent's input list
            target_input_list = [
                {"role": "system", "content": target_agent.build_prompt()},
                {"role": "user", "content": f"Recieved a message from {self.name}: {args['message']}"}
            ]
            
            # Get the target agent's response with tools
            target_response = await client.responses.create(
                model="gpt-5.2",
                reasoning={"effort": "low"},
                tools=tools,
                tool_choice="required",
                input=target_input_list,
            )
            function_call_item = None
            for item in target_response.output:
                if item.type == "function_call":
                    function_call_item = item
                    break
            assert function_call_item is not None, f"No function call found: {target_response.output}"
            

            args = json.loads(function_call_item.arguments)
            communication_tokens += len(tokenizer.encode(args['message']))
            if observer:
                await _maybe_await(
                    observer(
                        {
                            "type": "agent_message",
                            "from": target_agent.name,
                            "to": self.name,
                            "direction": "return",
                            "message": args["message"],
                            "tokens": communication_tokens,
                        }
                    )
                )
            
            message_back = f"Recieved a message from {target_agent.name}: {args['message']}"
            input_list.append({
                "type": "function_call_output",
                "call_id": original_function_call_item.call_id,
                "output": json.dumps({
                    "result": message_back
                })
            })
                    
        
        # Get final response from the model
        final_response = await client.responses.create(
            model="gpt-5.2",
            tools=tools,
            tool_choice="none",
            reasoning={"effort": "low"},
            input=input_list,
        )
        if observer:
            await _maybe_await(
                observer(
                    {
                        "type": "final",
                        "from": self.name,
                        "message": final_response.output_text,
                        "tokens": communication_tokens,
                    }
                )
            )
        return final_response.output_text, communication_tokens 

    def build_prompt(self) -> str:
        rules = self.communication_protocal.rules
        return f"""
{self.role}

Here is your communication channel to other agents:
{rules}        
"""



class CommunicationProtocol:
    def __init__(self, rules: str, agents: list[Agent]):
        self.rules = rules
        self.agents = agents
        for agent in agents:
            agent.communication_protocal = self


@dataclass
class ProtocolNode:
    id: str
    parent_id: Optional[str]
    round_index: int
    rule: str
    communication_tokens: float
    response_text: str

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "parent_id": self.parent_id,
            "round_index": self.round_index,
            "rule": self.rule,
            "communication_tokens": self.communication_tokens,
            "response_text": self.response_text,
        }


class Optimizer:
    """
    Iteratively rewrites a communication protocol to reduce token usage.
    Generates N variations each round, evaluates them, picks the cheapest, and repeats.
    """

    def __init__(
        self,
        communication_protocal: CommunicationProtocol,
        entry_agent: Optional[Agent] = None,
        variation_count: int = 10,
        rounds: int = 3,
        variation_model: str = "gpt-5.2",
    ):
        self.communication_protocal = communication_protocal
        self.entry_agent = entry_agent or communication_protocal.agents[0]
        self.variation_count = variation_count
        self.rounds = rounds
        self.variation_model = variation_model
        self.tree: List[ProtocolNode] = []
        self.best_path: List[str] = []

    async def optimize(
        self,
        input_prompts: Union[List[str], str],
        rounds: Optional[int] = None,
        variation_count: Optional[int] = None,
    ) -> ProtocolNode:
        prompts = input_prompts if isinstance(input_prompts, list) else [input_prompts]
        total_rounds = rounds or self.rounds
        branch_size = variation_count or self.variation_count

        self.tree.clear()
        self.best_path = []

        root_response, root_tokens = await self._evaluate_rule(
            rule=self.communication_protocal.rules,
            input_prompts=prompts,
        )
        print(f"[opt] Round 0 base rule tokens={root_tokens}")
        current_best = self._record_node(
            rule=self.communication_protocal.rules,
            parent_id=None,
            round_index=0,
            tokens=root_tokens,
            response_text=root_response,
        )
        self.best_path.append(current_best.id)

        for round_index in range(1, total_rounds + 1):
            variations = await self._generate_variations(
                base_rule=current_best.rule,
                variation_count=branch_size,
            )
            if not variations:
                break

            candidates: List[ProtocolNode] = []
            eval_tasks = [
                self._evaluate_rule(rule=rule, input_prompts=prompts)
                for rule in variations
            ]
            eval_results = await asyncio.gather(*eval_tasks)

            for rule, (response_text, tokens) in zip(variations, eval_results):
                print(f"[opt] Round {round_index} candidate tokens={tokens}")
                candidate = self._record_node(
                    rule=rule,
                    parent_id=current_best.id,
                    round_index=round_index,
                    tokens=tokens,
                    response_text=response_text,
                )
                candidates.append(candidate)

            candidates.sort(key=lambda node: node.communication_tokens)
            current_best = candidates[0]
            print(f"[opt] Round {round_index} selected tokens={current_best.communication_tokens}")
            self.best_path.append(current_best.id)
            self.communication_protocal.rules = current_best.rule

        self.communication_protocal.rules = current_best.rule
        return current_best

    async def optimize_events(
        self,
        input_prompts: Union[List[str], str],
        rounds: Optional[int] = None,
        variation_count: Optional[int] = None,
    ):
        prompts = input_prompts if isinstance(input_prompts, list) else [input_prompts]
        total_rounds = rounds or self.rounds
        branch_size = variation_count or self.variation_count

        self.tree.clear()
        self.best_path = []

        root_response, root_tokens = await self._evaluate_rule(
            rule=self.communication_protocal.rules,
            input_prompts=prompts,
        )
        current_best = self._record_node(
            rule=self.communication_protocal.rules,
            parent_id=None,
            round_index=0,
            tokens=root_tokens,
            response_text=root_response,
        )
        self.best_path.append(current_best.id)
        yield {
            "type": "base_evaluated",
            "node": current_best.as_dict(),
            "best_path": list(self.best_path),
        }

        for round_index in range(1, total_rounds + 1):
            variations = await self._generate_variations(
                base_rule=current_best.rule,
                variation_count=branch_size,
            )
            if not variations:
                break

            candidates: List[ProtocolNode] = []
            for rule in variations:
                response_text, tokens = await self._evaluate_rule(
                    rule=rule,
                    input_prompts=prompts,
                )
                candidate = self._record_node(
                    rule=rule,
                    parent_id=current_best.id,
                    round_index=round_index,
                    tokens=tokens,
                    response_text=response_text,
                )
                candidates.append(candidate)
                yield {
                    "type": "candidate_evaluated",
                    "node": candidate.as_dict(),
                    "round_index": round_index,
                }

            candidates.sort(key=lambda node: node.communication_tokens)
            current_best = candidates[0]
            self.best_path.append(current_best.id)
            self.communication_protocal.rules = current_best.rule
            yield {
                "type": "best_updated",
                "node": current_best.as_dict(),
                "best_path": list(self.best_path),
            }

        self.communication_protocal.rules = current_best.rule
        yield {
            "type": "done",
            "best_node": current_best.as_dict(),
            "tree": self.tree_as_dicts(),
            "best_path": list(self.best_path),
        }

    def _record_node(
        self,
        rule: str,
        parent_id: Optional[str],
        round_index: int,
        tokens: float,
        response_text: str,
    ) -> ProtocolNode:
        node = ProtocolNode(
            id=str(uuid.uuid4()),
            parent_id=parent_id,
            round_index=round_index,
            rule=rule,
            communication_tokens=tokens,
            response_text=response_text,
        )
        self.tree.append(node)
        return node

    async def _generate_variations(
        self,
        base_rule: str,
        variation_count: int,
    ) -> List[str]:
        class VariationList(BaseModel):
            variations: List[str]

        agent_system_messages = [
            f"{agent.name or 'Agent'}\nRole: {agent.role.strip()}"
            for agent in self.communication_protocal.agents
        ]

        async def generate_single_variation() -> Optional[str]:
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You are refining a communication protocol between two agents. "
                        "Produce concise alternatives that **minimize** the number of tokens "
                        "needed for a single exchange while preserving clarity. This could be some abbreviation synonyms or some template for the communication. Your communication protocal might be detailed and should include examples of the communication. Try not to limit the amount of actual information that is passed to each agent. Instead forcus on formtting of the communication, and telling the agents to abbreviate and make the communication as short as possible. The communication protocal itsefl does not need to be concise, it should be in natural language with full sentences, even paragraphs if needed, and easy to understand."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Current rule:\n{base_rule}\n\n"
                        "Agent system messages for context:\n"
                        + "\n\n".join(agent_system_messages)
                        + "\n\n"
                        "Return exactly 1 alternative rule. "
                    ),
                },
            ]

            completion = await client.chat.completions.parse(
                model=self.variation_model,
                messages=messages,
                response_format=VariationList,
            )
            parsed = completion.choices[0].message.parsed
            variations_raw = parsed.variations if parsed else []
            for item in variations_raw:
                if isinstance(item, str):
                    cleaned = item.strip()
                    if cleaned:
                        return cleaned
            return None

        single_variation_tasks = [
            generate_single_variation() for _ in range(variation_count)
        ]
        variations_clean = await asyncio.gather(*single_variation_tasks)

        # Deduplicate while preserving order and limit to requested count
        seen = set()
        unique_variations = []
        for item in variations_clean:
            if item and item not in seen:
                unique_variations.append(item)
                seen.add(item)
            if len(unique_variations) >= variation_count:
                break

        print(f"[opt] Generated {len(unique_variations)} variations")
        return unique_variations

    async def _evaluate_rule(
        self,
        rule: str,
        input_prompts: List[str],
    ) -> tuple[str, float]:
        print(f"[opt] Evaluating rule:\n{rule}")
        # Clone agents to avoid mutating shared protocol during parallel eval
        temp_agents = [Agent(role=a.role, name=a.name) for a in self.communication_protocal.agents]
        temp_protocol = CommunicationProtocol(rule, temp_agents)
        temp_entry_agent = next(
            (a for a in temp_agents if a.name == self.entry_agent.name),
            temp_agents[0],
        )
        if not input_prompts:
            return "", 0.0

        results = await asyncio.gather(*(temp_entry_agent.run(prompt) for prompt in input_prompts))
        responses, token_counts = zip(*results)
        average_tokens = sum(token_counts) / len(token_counts)
        primary_response = responses[0] if responses else ""
        return primary_response, average_tokens

    def tree_as_dicts(self) -> List[dict]:
        """Return tree nodes keyed by IDs for downstream visualization APIs."""
        return [node.as_dict() for node in self.tree]


async def _maybe_await(result):
    if asyncio.iscoroutine(result):
        await result


agent_tom = Agent(
    name = "Tom's personal assistant",
    role = """You are an scheduling assistant for Tom. Here is Tom's schedule:
Monday: 9am-11am Team Meeting, 2pm-3pm Client Call
Tuesday: 10am-12pm Project Review
Wednesday: Free
Thursday: 1pm-2pm One-on-One with Manager
Friday: 3pm-4pm Team Standup

You can only use the communication channel once, therefore include all the relevant information, and make decision without confirming with the other agent.""",
)

agent_jerry = Agent(
    name = "Jerry's personal assistant",
    role = """You are an scheduling assistant for Jerry. Here is Jerry's schedule:
Monday: 10am-12pm Design Review, 3pm-5pm Workshop
Tuesday: Free
Wednesday: 9am-10am All Hands, 2pm-4pm Focus Time
Thursday: 11am-12pm Lunch Meeting
Friday: Free

You can only use the communication channel once, therefore include all the relevant information, and make decision without confirming with the other agent.
""",
)


communication_protocal = CommunicationProtocol(
    rules  = "This is a communication channel between Tom and Jerry's agents. ",
    agents = [agent_tom, agent_jerry]
)


if __name__ == "__main__":
    async def _demo():
        return await agent_tom.run(
            "I need to schedule a meeting with Jerry this week. You can only use the communication channel once. "
            "You can only use the communication channel once, therefore include all the relevant information, "
            "and make decision without confirming with the other agent."
        )
    async def _optimize_demo():
        optimizer = Optimizer(communication_protocal, variation_count=10, rounds=3)
        best = await optimizer.optimize(
            input_prompts=[
                "I need to schedule a meeting with Jerry this week.",
                "I wanna schedule a meeting within the next 2 days.",
                "When is the earliest time I can schedule a meeting with Jerry?"
            ],
        )
        print("Best rule:", best.rule)
        print(json.dumps(optimizer.tree_as_dicts(), indent=2))

    # Uncomment to run demo (triggers API calls)
    #asyncio.run(_demo())
    asyncio.run(_optimize_demo())

# Example optimizer usage (kept disabled to avoid unintended API calls):
# async def _optimize_demo():
#     optimizer = Optimizer(communication_protocal, variation_count=10, rounds=3)
#     best = await optimizer.optimize(
#         input_prompt="I need to schedule a meeting with Jerry this week. Keep the communication as short as possible.",
#     )
#     print("Best rule:", best.rule)
#     print(json.dumps(optimizer.tree_as_dicts(), indent=2))
# asyncio.run(_optimize_demo())
