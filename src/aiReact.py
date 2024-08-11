import os
import sys
import subprocess
import logging
from openai import OpenAI

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Ensure the OpenAI API key is set in the environment
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
if not OPENAI_API_KEY:
    logging.error("The OpenAI API key is not set in the environment.")
    sys.exit(1)

# Initialize OpenAI client
client = OpenAI(api_key=OPENAI_API_KEY)

# Pricing for GPT-4o and GPT-4o-mini in dollars per million tokens
pricing = {
    'gpt-4o': {
        'input': 5.00 / 1_000_000,
        'output': 15.00 / 1_000_000
    },
    'gpt-4o-mini': {
        'input': 0.15 / 1_000_000,
        'output': 0.60 / 1_000_000
    }
}

def get_bug_or_feature_description(input_source):
    """Get the bug or feature description from either a quoted string or file."""
    logging.info("Entering get_bug_or_feature_description")
    try:
        if os.path.isfile(input_source):
            with open(input_source, 'r') as file:
                description = file.read().strip()
        else:
            description = input_source.strip()
        logging.info("Successfully retrieved bug or feature description")
        return description
    except Exception as e:
        logging.error(f"Error retrieving description: {e}")
        raise
    finally:
        logging.info("Exiting get_bug_or_feature_description")

def call_gpt4o(model, app_js_content, description, max_output_tokens, image_path=None):
    """Call the GPT-4o or GPT-4o-mini API with the given App.js content, user description, and optional image."""
    logging.info("Entering call_gpt4o")
    try:
        # Include the full content of App.js in the prompt
        prompt = f"Here is the current App.js:\n\n{app_js_content}\n\nPlease {description}."
        logging.info(f"Calling GPT-4o with prompt (truncated): {prompt[:50]}...")
        logging.info(f"Model: {model}, Max Output Tokens: {max_output_tokens}, Image Provided: {bool(image_path)}")

        messages = [
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": "You are a helpful assistant for React development."
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ]

        if image_path and os.path.isfile(image_path):
            with open(image_path, "rb") as img:
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "image": img.read()
                        }
                    ]
                })

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.7,
            max_tokens=max_output_tokens,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            response_format={
                "type": "text"
            }
        )

        # Correctly access the response object attributes
        choices = response.choices[0].message.content
        usage = response.usage

        # Extract tokens used and cost calculation
        input_tokens = usage.prompt_tokens
        output_tokens = usage.completion_tokens
        total_tokens = usage.total_tokens

        input_cost = input_tokens * pricing[model]['input']
        output_cost = output_tokens * pricing[model]['output']
        total_cost = input_cost + output_cost

        logging.info(f"Tokens used: {total_tokens} (Input: {input_tokens}, Output: {output_tokens})")
        logging.info(f"Cost for this request: ${total_cost:.6f}")

        return choices, total_tokens, total_cost
    except Exception as e:
        logging.error(f"Error during GPT-4o API call: {e}")
        raise
    finally:
        logging.info("Exiting call_gpt4o")

def lint_app_js():
    """Run ESLint on the App.js file."""
    logging.info("Entering lint_app_js")
    try:
        result = os.system("eslint App.js --fix")
        if result != 0:
            logging.warning("ESLint failed with non-zero exit code")
            return False
        logging.info("ESLint passed successfully")
        return True
    except Exception as e:
        logging.error(f"Error during linting: {e}")
        raise
    finally:
        logging.info("Exiting lint_app_js")

def git_commit(commit_message):
    """Commit the changes to the git repository."""
    logging.info("Entering git_commit")
    try:
        subprocess.run(["git", "add", "App.js"], check=True)
        subprocess.run(["git", "commit", "-m", commit_message], check=True)
        logging.info(f"Successfully committed changes with message: {commit_message}")
    except subprocess.CalledProcessError as e:
        logging.error(f"Git commit failed: {e}")
        raise
    except Exception as e:
        logging.error(f"Unexpected error during git commit: {e}")
        raise
    finally:
        logging.info("Exiting git_commit")

def parse_arguments():
    """Parse command-line arguments safely."""
    logging.info("Parsing command-line arguments")
    try:
        if len(sys.argv) < 3:
            raise ValueError("Insufficient arguments provided")

        app_js_path = sys.argv[1]
        description_source = sys.argv[2]
        max_output_tokens = 10000
        model = "gpt-4o"
        image_path = None

        # Parse optional max_output_tokens, model, and image path arguments
        for arg in sys.argv[3:]:
            if arg.startswith("--max-output-tokens"):
                try:
                    max_output_tokens = int(arg.split('=', 1)[1])
                except (IndexError, ValueError) as e:
                    logging.error(f"Error parsing max-output-tokens: {e}")
                    raise ValueError("Invalid value for --max-output-tokens")
            elif arg == "--mini":
                model = "gpt-4o-mini"
            elif arg.startswith("--image"):
                try:
                    image_path = arg.split('=', 1)[1]
                except IndexError:
                    logging.error("Error parsing image path")
                    raise ValueError("Invalid value for --image")

        return app_js_path, description_source, max_output_tokens, model, image_path
    except Exception as e:
        logging.error(f"Error during argument parsing: {e}")
        raise
    finally:
        logging.info("Finished parsing command-line arguments")

def main():
    logging.info("Starting main function")
    try:
        app_js_path, description_source, max_output_tokens, model, image_path = parse_arguments()

        # Read the current App.js content
        with open(app_js_path, 'r') as app_js_file:
            app_js_content = app_js_file.read()

        # Get the bug or feature description
        description = get_bug_or_feature_description(description_source)

        # Call GPT-4o or GPT-4o-mini to modify the App.js content
        new_app_js_content, total_tokens, total_cost = call_gpt4o(model, app_js_content, description, max_output_tokens, image_path)

        # Save the modified App.js content
        with open(app_js_path, 'w') as app_js_file:
            app_js_file.write(new_app_js_content)

        # Lint the modified App.js file
        if lint_app_js():
            # If linting is successful, commit the changes
            commit_message = f"Auto-modified App.js to {description} (Tokens used: {total_tokens}, Cost: ${total_cost:.6f})"
            git_commit(commit_message)
            logging.info("Changes committed successfully.")
        else:
            # If linting fails, interact with the user
            logging.warning("Linting failed. Prompting user for additional instructions.")
            print("Linting failed. Please provide additional instructions to resolve the issue.")
            additional_input = input("Describe how to resolve the linting issue: ")
            new_app_js_content, retry_tokens, retry_cost = call_gpt4o(model, new_app_js_content, additional_input, max_output_tokens, image_path)
            
            # Update total tokens and cost with retry attempt
            total_tokens += retry_tokens
            total_cost += retry_cost

            with open(app_js_path, 'w') as app_js_file:
                app_js_file.write(new_app_js_content)

            # Re-run linting after the second modification attempt
            if lint_app_js():
                commit_message = f"Auto-modified App.js with user input to resolve {description} (Total Tokens: {total_tokens}, Total Cost: ${total_cost:.6f})"
                git_commit(commit_message)
                logging.info("Changes committed successfully after resolving linting issues.")
            else:
                logging.error("Linting failed again. Manual resolution required.")
                print("Linting failed again. Please resolve the issues manually.")
    except ValueError as ve:
        logging.critical(f"ValueError in main: {ve}")
        print(f"Error: {ve}")
    except Exception as e:
        logging.critical(f"An unexpected error occurred in main: {e}")
        print(f"Unexpected error: {e}")
    finally:
        logging.info("Exiting main function")

if __name__ == "__main__":
    main()
