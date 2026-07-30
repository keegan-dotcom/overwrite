.PHONY: install test test-agent test-contracts validate demo run status kill pause resume

install:
	pip install -r requirements.txt -r requirements-dev.txt
	cd contracts && npm install

test: test-agent test-contracts

test-agent:
	python -m pytest tests/ -q

test-contracts:
	cd contracts && npx hardhat test

validate:
	python -m backtest.run_validation

demo:
	python -m agent.main once --config configs/config.example.yaml

run:
	python -m agent.main run --config configs/config.example.yaml

status:
	python -m agent.main status --config configs/config.example.yaml

kill:
	mkdir -p data && touch data/KILL && echo "KILL switch ON (rm data/KILL to resume)"

pause:
	mkdir -p data && touch data/PAUSE && echo "paused new sells (rm data/PAUSE to resume)"

resume:
	rm -f data/KILL data/PAUSE && echo "resumed"
