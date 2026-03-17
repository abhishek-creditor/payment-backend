pipeline {
agent any

```
environment {
    EC2_USER = "ubuntu"
    BASTION_IP = "54.209.68.124"
    PRIVATE_IP = "10.0.4.146"
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

    stage('Deploy via Bastion') {
        steps {
            echo "Deploying to Private EC2 via Bastion..."

            withCredentials([sshUserPrivateKey(credentialsId: 'ec2-ssh-key', keyFileVariable: 'SSH_KEY')]) {
                sh """
                    ssh -i $SSH_KEY -o StrictHostKeyChecking=no -J ${EC2_USER}@${BASTION_IP} ${EC2_USER}@${PRIVATE_IP} '
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
        echo "Deployment successful!"
    }
    failure {
        echo "Deployment failed!"
    }
}
```

}
