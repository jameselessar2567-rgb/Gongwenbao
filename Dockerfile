FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY jobkit ./jobkit
ENV PORT=8080
EXPOSE 8080
CMD ["python", "-m", "jobkit", "studio", "--host", "0.0.0.0", "--port", "8080"]
