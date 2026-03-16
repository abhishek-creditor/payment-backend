pipeline {
    agent any

    stages {


          stage('Clean Workspace') {
            steps {
                deleteDir()
            }
        }

         
        stage('Clone Repository') {
            steps {
                git branch: 'main',
                credentialsId: 'payment-access',
                url: 'https://github.com/abhishek-creditor/payment-backend.git'
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build || echo "No build step"'
            }
        }

        stage('Start Server') {
            steps {
                sh 'pm2 restart payment-backend || pm2 start src/index.js --name payment-backend'
            }
        }
    }

    post {
        success {
            echo "Deployment successful (main branch)!"
        }
        failure {
            echo "Deployment failed!"
        }
    }
}