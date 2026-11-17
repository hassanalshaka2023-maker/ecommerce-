FROM python:3.13-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=proto warehouse.proto proto/
COPY server.py .
RUN python -m grpc_tools.protoc -I proto --python_out=. --grpc_python_out=. proto/warehouse.proto

CMD ["python", "-u", "server.py"]
