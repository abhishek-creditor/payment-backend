pipeline {
agent any

```
environment {
    EC2_USER = "ubuntu"
    EC2_HOST = "3.212.62.124"
    APP_DIR  = "/var/www/payment-backend/payment-backend"
    BRANCH   = "main"
}

stages {

    stage('Clean Workspace') {
        steps {
            deleteDir()
        }
    }

    stage('Clone Repository') {
        steps {
            git branch: "${BRANCH}",
            credentialsId: 'payment-access',
            url: 'https://github.com/abhishek-creditor/payment-backend.git'
        }
    }

    stage('Deploy to EC2') {
        steps {
            echo "Deploying to EC2 server..."

            sshagent(credentials: ['ec2-ssh-key']) {
                sh """
                    ssh -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} '
                        cd ${APP_DIR} &&
                        git fetch --all &&
                        git reset --hard origin/${BRANCH} &&
                        npm install &&
                        npx prisma generate &&
                        npm run build || echo "No build step" &&
                        pm2 restart payment-backend || pm2 start src/index.js --name payment-backend
                    '
                """
            }
        }
    }
}

post {
    success {
        echo "Deployment successful (EC2)!"
    }
    failure {
        echo "Deployment failed!"
    }
}
```

}
