function updateStatus(message, isError = false) {
    const statusBar = document.getElementById('status-bar');
    statusBar.textContent = message;
    statusBar.style.background = isError ? '#dc3545' : '#007bff';
}

// Function to get OAuth token
async function getAccessToken(clientId, clientSecret) {
    try {
        updateStatus('Fetching access token...');
        const response = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        updateStatus('Access token retrieved');
        return data.access_token;
    } catch (error) {
        updateStatus(`Error getting access token: ${error.message}`, true);
        return null;
    }
}

// Function to fetch subreddit posts until desired number of media posts is reached
async function fetchPosts(clientId, clientSecret, subreddit, sort, limit, timeFilter) {
    try {
        updateStatus('Fetching posts...');
        const token = await getAccessToken(clientId, clientSecret);
        if (!token) return { mediaPosts: [], nonMediaPosts: [] };

        let mediaPosts = [];
        let nonMediaPosts = [];
        let after = '';
        let requestCount = 0;
        const maxRequests = limit === 1 ? 3 : Math.max(3, limit * 3); // For limit=1, max 3 requests; otherwise, 3x limit
        const batchSize = Math.min(limit + 5, 100); // Fetch slightly more than limit, cap at 100
        let baseUrl = `https://oauth.reddit.com/r/${subreddit}/${sort}.json?limit=${batchSize}`;
        if (sort === 'top' && timeFilter) {
            baseUrl += `&t=${timeFilter}`;
        }

        // Fetch until we have 'limit' media posts or hit request limit
        while (mediaPosts.length < limit && requestCount < maxRequests) {
            const url = after ? `${baseUrl}&after=${after}` : baseUrl;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const posts = data.data.children.map(child => child.data);
            if (posts.length === 0) break; // No more posts available

            // Filter media posts (.gif, .jpg, .jpeg, .png)
            for (const post of posts) {
                let imageUrl = post.url;
                const urlLower = post.url.toLowerCase().split('?')[0]; // Remove query parameters

                // Check post.url first
                if (
                    urlLower.endsWith('.gif') ||
                    urlLower.endsWith('.jpg') ||
                    urlLower.endsWith('.jpeg') ||
                    urlLower.endsWith('.png')
                ) {
                    if (mediaPosts.length < limit) {
                        mediaPosts.push(post);
                    } else {
                        nonMediaPosts.push(post); // Excess media posts go to non-media list
                    }
                } else {
                    // Check preview for .gif, .jpg, .jpeg, .png
                    const previewUrl = post.preview?.images?.[0]?.source?.url ||
                                      post.preview?.images?.[0]?.variants?.gif?.source?.url ||
                                      '';
                    const previewUrlLower = previewUrl.toLowerCase().split('?')[0];
                    if (
                        previewUrlLower.endsWith('.gif') ||
                        previewUrlLower.endsWith('.jpg') ||
                        previewUrlLower.endsWith('.jpeg') ||
                        previewUrlLower.endsWith('.png')
                    ) {
                        if (mediaPosts.length < limit) {
                            post.url = previewUrl; // Use preview URL for display
                            mediaPosts.push(post);
                        } else {
                            nonMediaPosts.push(post);
                        }
                    } else {
                        nonMediaPosts.push(post);
                    }
                }

                // Stop processing this batch if we have enough media posts
                if (mediaPosts.length >= limit) {
                    nonMediaPosts.push(...posts.slice(posts.indexOf(post) + 1));
                    break;
                }
            }

            // Exit if we have enough media posts
            if (mediaPosts.length >= limit) {
                break;
            }

            // For limit=1, check if we've hit 3 requests with no media posts
            if (limit === 1 && requestCount === 2 && mediaPosts.length === 0) {
                const continueFetching = window.confirm(
                    `No image posts found after 3 attempts. Continue fetching?`
                );
                if (!continueFetching) {
                    updateStatus('Stopped fetching: No image posts found', true);
                    break;
                }
            }

            // Update 'after' for the next page
            after = data.data.after;
            requestCount++;
            if (!after) break; // No more pages available

            updateStatus(`Fetched ${mediaPosts.length}/${limit} image posts...`);
            // Add delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        updateStatus(`Successfully fetched ${mediaPosts.length} image posts`);
        return { mediaPosts, nonMediaPosts };
    } catch (error) {
        updateStatus(`Error fetching posts: ${error.message}`, true);
        return { mediaPosts: [], nonMediaPosts: [] };
    }
}

// Function to filter and display media
async function displayMedia() {
    const clientId = document.getElementById('client-id').value.trim();
    const clientSecret = document.getElementById('client-secret').value.trim();
    const redditInput = document.getElementById('subreddit-input').value.trim();
    const limitInput = parseInt(document.getElementById('limit-input').value) || 5;
    const sort = document.querySelector('.sort-button.active')?.dataset.sort || 'best';
    const timeFilter = sort === 'top' ? document.querySelector('.time-button.active')?.dataset.time || 'day' : null;

    // Validate inputs
    if (!clientId || !clientSecret) {
        updateStatus('Please enter Client ID and Secret', true);
        return;
    }
    if (!redditInput) {
        updateStatus('Please enter a subreddit or multireddit', true);
        return;
    }
    const limit = Math.min(Math.max(limitInput, 1), 100);

    const feedContainer = document.getElementById('feed-container');
    const nonMediaList = document.getElementById('non-media-items');
    const loadingSpinner = document.getElementById('loading-spinner');
    feedContainer.innerHTML = '';
    nonMediaList.innerHTML = '';
    loadingSpinner.style.display = 'block';

    const { mediaPosts, nonMediaPosts } = await fetchPosts(clientId, clientSecret, redditInput, sort, limit, timeFilter);

    loadingSpinner.style.display = 'none';

    // Display media posts
    mediaPosts.forEach(post => {
        const feedItem = document.createElement('div');
        feedItem.className = 'feed-item';

        // Create image
        const img = document.createElement('img');
        img.className = 'thumbnail';
        img.src = post.url;
        img.alt = post.title;
        img.onerror = () => {
            img.className = 'thumbnail-placeholder';
            img.src = '';
            img.textContent = 'Image not available';
            // Move to non-media list
            const listItem = document.createElement('li');
            listItem.innerHTML = `Permalink: <a href="https://reddit.com${post.permalink}" target="_blank">${post.permalink}</a> | URL: <a href="${post.url}" target="_blank">${post.url}</a>`;
            nonMediaList.appendChild(listItem);
        };
        feedItem.appendChild(img);

        // Create title with permalink
        const title = document.createElement('a');
        title.className = 'title';
        title.href = `https://reddit.com${post.permalink}`;
        title.textContent = post.title.substring(0, 100);
        feedItem.appendChild(title);

        feedContainer.appendChild(feedItem);
    });

    // Display non-media posts
    nonMediaPosts.forEach(post => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `Permalink: <a href="https://reddit.com${post.permalink}" target="_blank">${post.permalink}</a> | URL: <a href="${post.url}" target="_blank">${post.url}</a>`;
        nonMediaList.appendChild(listItem);
    });

    // Warn if fewer than limit media posts were found
    if (mediaPosts.length < limit) {
        updateStatus(`Only ${mediaPosts.length} image posts found`, true);
    }
}

// Function to update layout and thumbnail size
function updateLayout() {
    const layout = document.querySelector('.layout-button.active')?.dataset.layout || 'grid';
    const columns = document.getElementById('columns-slider').value;
    const size = document.getElementById('size-slider').value;
    const feedContainer = document.getElementById('feed-container');

    feedContainer.className = layout;
    feedContainer.style.setProperty('--columns', columns);
    feedContainer.style.setProperty('--thumbnail-size', `${size}px`);
}

// Event listeners
function setupEventListeners() {
    const timeFilterDiv = document.querySelector('.time-filter');

    // Sort buttons
    document.querySelectorAll('.sort-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.sort-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            timeFilterDiv.style.display = button.dataset.sort === 'top' ? 'flex' : 'none';
            if (button.dataset.sort === 'top') {
                document.querySelector('.time-button[data-time="day"]').classList.add('active');
            }
            displayMedia();
        });
    });

    // Time filter buttons
    document.querySelectorAll('.time-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.time-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            displayMedia();
        });
    });

    // Layout buttons
    document.querySelectorAll('.layout-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.layout-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            updateLayout();
            displayMedia();
        });
    });

    // Sliders
    document.getElementById('columns-slider').addEventListener('input', updateLayout);
    document.getElementById('size-slider').addEventListener('input', updateLayout);

    // Inputs
    document.getElementById('client-id').addEventListener('change', displayMedia);
    document.getElementById('client-secret').addEventListener('change', displayMedia);
    document.getElementById('subreddit-input').addEventListener('change', displayMedia);
    document.getElementById('limit-input').addEventListener('change', displayMedia);
}

// Set defaults
document.querySelector('.sort-button[data-sort="best"]').classList.add('active');
document.querySelector('.layout-button[data-layout="grid"]').classList.add('active');

// Initialize
setupEventListeners();
updateLayout();
displayMedia();