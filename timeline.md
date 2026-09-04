Start Date : 29th July

Target for week # 1:


Setup a Node.js Project

---

Target for next(2nd) week:

Develop a simple user interface for uploading documents (PDF, Excel, and Word) with a maximum file size of 2 MB.
Develop the document upload and storage process, including backend handling and file persistence.

---


Target for next(third) week:

Integrate Cloud Object Storage into the project.
Explore Text Extraction Technologies; build and integrate text extraction functionality into the project. 

---

Targets for Next Week(4th):

Clean extracted text by removing noise, redundant whitespace, and systemic formatting artifacts.
Optimize processing performance to minimize extraction latency and ensure fast document execution times.
Add error handling to gracefully manage corrupted files or failed extraction processes.
Explore Milvus Database.    

---

Target for 5th Week:

Install and configure the Milvus database in the project.
Explore difference btw Relational and Vector Databases.
Explore what are vector embeddings.
Explore Vector Indexing Types.

---

Target for 6th Week:
Try creating a Collection and Schema for the GS schedule in Milvus DB.
Try creating Data for the Gs schedule, which we will be used to create vectorized data by embedding model to insert in our Milvus DB. 

---

Target for 7th week:

Study text embedding models and implement the process of converting the text_to_embed field into vector embeddings for use in semantic search.
Insert vectors and metadata into Milvus; flush and index the collection.

---

Target for 8th week:

created  sample data for the Gs schedules for testing purposes.
mplement data chunking and overlap strategies.
Explore different use cases to develop a more robust and effective logic.

---

Target for 9th Week:

Compare different embedding models and evaluate their impact on semantic search accuracy.
Explore different Classification models.
Create documents for testing.
Create Classification Flow.
Design a structured prompt combining instructions, the retrieved candidate series, and the document text.

---

Target for 10th Week:

Design a structured prompt combining instructions, the retrieved candidate series, and the document text.
Send the prompt to the AI model for classification.
Parse the AI model’s output (Series Number and reasoning).
Map the Series Number back to its full metadata to Display to user (Schedule Title, Schedule Number, Series Title, Retention Period, Disposition Method).
Flow testing for different formats (pdf, word, excel, image ) and OCR.
Fix areas Identified during testing.


---

Target for 11th Week:

Flow testing with different formats (pdf, word, excel, image ) and OCR, Check how much time each formats take to return classification results.
Start Flow documentation (architecture, pipeline design, classification logic).
Bonus task: project deployment.